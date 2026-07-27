const mongoose = require('mongoose');
const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Return = require('../models/Return');
const Expense = require('../models/Expense');
const StockMovement = require('../models/StockMovement');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const Client = require('../models/Client');

/**
 * ملخص شامل للعميل الحالي
 * GET /api/reports/summary
 */
exports.getSummary = async (req, res) => {
    try {
        const cid = req.customerId;

        const [
            totalItemsCount,
            totalPurchaseInvoicesAgg,
            totalSalesAgg,
            totalCOGSAgg,
            totalReturnsAgg,
            totalReturnsCOGSAgg,
            expensesList,
            recentSales,
            lowStockItems,
            unpaidInvoicesCount,
            partiallyPaidCount,
            topDebtorClient
        ] = await Promise.all([
            Item.countDocuments({ customerId: cid }),
            PurchaseInvoice.aggregate([
                { $match: { customerId: cid, status: 'posted' } },
                { $group: { _id: null, total: { $sum: "$grandTotal" }, count: { $sum: 1 } } }
            ]),
            SaleInvoice.aggregate([
                { $match: { customerId: cid } },
                { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } }
            ]),
            SaleInvoice.aggregate([
                { $match: { customerId: cid } },
                    { $group: { _id: null, total: { $sum: { $ifNull: ["$totalCost", { $multiply: ["$quantity", "$costPrice"] }] } } } }
            ]),
            Return.aggregate([
                { $match: { customerId: cid } },
                { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } }
            ]),
            Return.aggregate([
                { $match: { customerId: cid } },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$totalCost", { $multiply: ["$quantity", "$costPrice"] }] } } } }
            ]),
            Expense.find({ customerId: cid }).lean(),
            SaleInvoice.find({ customerId: cid }).sort({ createdAt: -1 }).limit(5).lean(),
            Item.find({ customerId: cid, quantity: { $lt: 5 } }).limit(10).lean(),
            SaleInvoice.countDocuments({ customerId: cid, paymentStatus: 'unpaid' }),
            SaleInvoice.countDocuments({ customerId: cid, paymentStatus: 'partial' }),
            Client.findOne({ customerId: cid, balance: { $gt: 0 } }).sort({ balance: -1 }).lean()
        ]);

        const totalExpenses = expensesList.reduce((sum, e) => sum + e.amount, 0);
        const grossSales = totalSalesAgg[0]?.total || 0;
        const grossCOGS = totalCOGSAgg[0]?.total || 0;
        const totalReturns = totalReturnsAgg[0]?.total || 0;
        const returnsCOGS = totalReturnsCOGSAgg[0]?.total || 0;
        const totalSales = grossSales - totalReturns;
        const totalCOGS = grossCOGS - returnsCOGS;
        const totalPurchaseInvoices = totalPurchaseInvoicesAgg[0]?.total || 0;
        const netProfit = totalSales - totalCOGS - totalExpenses;

        res.json({
            status: true,
            data: {
                customerId: cid,
                companyName: req.user?.companyName || '',
                inventory: {
                    totalItems: totalItemsCount,
                    lowStockItems
                },
                financials: {
                    totalSales,
                    grossSales,
                    totalReturns,
                    salesCount: totalSalesAgg[0]?.count || 0,
                    totalCOGS,
                    grossCOGS,
                    returnsCOGS,
                    totalPurchases: totalPurchaseInvoices,
                    purchasesCount: totalPurchaseInvoicesAgg[0]?.count || 0,
                    totalExpenses,
                    netProfit,
                    unpaidInvoicesCount,
                    partiallyPaidCount
                },
                topDebtorClient: topDebtorClient ? {
                    _id: topDebtorClient._id,
                    name: topDebtorClient.name,
                    code: topDebtorClient.code,
                    phone: topDebtorClient.phone,
                    balance: topDebtorClient.balance
                } : null,
                recentSales
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * تقرير حركة المخزون مع فلاتر وتصفح صفحات
 * GET /api/reports/stock-movements?itemId=&direction=&reason=&from=&to=&page=1&limit=50
 */
exports.getStockMovements = async (req, res) => {
    try {
        const cid = req.customerId;
        const { itemId, direction, reason, from, to, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(200, Math.max(1, parseInt(limit)));

        const filter = { customerId: cid };
        if (itemId) {
            if (!mongoose.Types.ObjectId.isValid(itemId)) {
                return res.status(400).json({ status: false, message: 'Invalid itemId', data: null });
            }
            filter.itemId = itemId;
        }
        if (direction) {
            filter.direction = direction;
        }
        if (reason) {
            filter.reason = reason;
        }
        if (from || to) {
            filter.date = {};
            if (from) filter.date.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                filter.date.$lt = toDate;
            }
        }

        const [movements, total] = await Promise.all([
            StockMovement.find(filter)
                .populate('itemId')
                .sort({ date: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            StockMovement.countDocuments(filter)
        ]);

        res.json({
            status: true,
            data: {
                customerId: cid,
                pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
                movements
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.getProfitSummaryJson = async (req, res) => {
    try {
        const cid = req.customerId;
        const totalPurchaseInvoicesAgg = await PurchaseInvoice.aggregate([
            { $match: { customerId: cid, status: 'posted' } },
            { $group: { _id: null, total: { $sum: "$grandTotal" } } }
        ]);
        const salesAgg = await SaleInvoice.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: "$total" } } }
        ]);

        const cogsAgg = await SaleInvoice.aggregate([
            { $match: { customerId: cid } },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$totalCost", { $multiply: ["$quantity", "$costPrice"] }] } } } }
        ]);

        const returnsAgg = await Return.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: "$total" } } }
        ]);

        const returnsCOGSAgg = await Return.aggregate([
            { $match: { customerId: cid } },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$totalCost", { $multiply: ["$quantity", "$costPrice"] }] } } } }
        ]);

        const expenses = await Expense.find({ customerId: cid }).sort({ date: -1 }).lean();
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);

        const grossSales = salesAgg[0]?.total || 0;
        const grossCOGS = cogsAgg[0]?.total || 0;
        const totalReturns = returnsAgg[0]?.total || 0;
        const returnsCOGS = returnsCOGSAgg[0]?.total || 0;
        const totalSales = grossSales - totalReturns;
        const totalCOGS = grossCOGS - returnsCOGS;
        const netProfit = totalSales - totalCOGS - totalExpenses;

        res.json({
            status: true,
            data: {
                totalPurchases: totalPurchaseInvoicesAgg[0]?.total || 0,
                totalSales,
                grossSales,
                totalReturns,
                totalCOGS,
                grossCOGS,
                returnsCOGS,
                netProfit,
                totalExpenses,
                // purchases,
                // expenses
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: 'خطأ في جلب البيانات' });
    }
};

/**
 * تقرير المبيعات مع فلاتر تاريخية
 * GET /api/reports/sales?from=2024-01-01&to=2024-12-31&page=1&limit=50
 */
exports.getSalesReport = async (req, res) => {
    try {
        const cid = req.customerId;
        const { from, to, page = 1, limit = 50, groupBy } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(200, Math.max(1, parseInt(limit)));

        const filter = { customerId: cid };
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                filter.createdAt.$lt = toDate;
            }
        }

        const returnFilter = { customerId: cid };
        if (from || to) {
            returnFilter.date = {};
            if (from) returnFilter.date.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                returnFilter.date.$lt = toDate;
            }
        }

        const [invoices, total, salesAgg, returnsAgg] = await Promise.all([
            SaleInvoice.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            SaleInvoice.countDocuments(filter),
            SaleInvoice.aggregate([
                { $match: filter },
                { $group: { _id: null, totalRevenue: { $sum: "$total" }, totalQty: { $sum: "$quantity" }, avgPrice: { $avg: "$price" } } }
            ]),
            Return.aggregate([
                { $match: returnFilter },
                { $group: { _id: null, totalReturns: { $sum: "$total" }, totalReturnedQty: { $sum: "$quantity" } } }
            ])
        ]);

        const grossRevenue = salesAgg[0]?.totalRevenue || 0;
        const grossQuantitySold = salesAgg[0]?.totalQty || 0;
        const totalReturns = returnsAgg[0]?.totalReturns || 0;
        const totalReturnedQuantity = returnsAgg[0]?.totalReturnedQty || 0;
        const netRevenue = grossRevenue - totalReturns;
        const netQuantitySold = grossQuantitySold - totalReturnedQuantity;

        res.json({
            status: true,
            data: {
                customerId: cid,
                pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
                summary: {
                    totalRevenue: netRevenue,
                    grossRevenue,
                    totalReturns,
                    totalQuantitySold: netQuantitySold,
                    grossQuantitySold,
                    totalReturnedQuantity,
                    averagePrice: salesAgg[0]?.avgPrice || 0
                },
                invoices
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * تقرير المخزون الحالي
 * GET /api/reports/inventory?search=&lowStock=true
 */
exports.getInventoryReport = async (req, res) => {
    try {
        const cid = req.customerId;
        const { search, lowStock } = req.query;

        const filter = { customerId: cid };
        if (search) {
            filter.$or = [
                { modelNumber: { $regex: search, $options: 'i' } },
                { name: { $regex: search, $options: 'i' } }
            ];
        }
        if (lowStock === 'true') {
            filter.quantity = { $lt: 5 };
        }

        const [items, aggregate] = await Promise.all([
            Item.find(filter).sort({ quantity: 1 }).lean(),
            Item.aggregate([
                { $match: { customerId: cid } },
                {
                    $group: {
                        _id: null,
                        totalItems: { $sum: 1 },
                        totalValue: { $sum: { $multiply: ["$price", "$quantity"] } },
                        totalQuantity: { $sum: "$quantity" },
                        outOfStock: { $sum: { $cond: [{ $eq: ["$quantity", 0] }, 1, 0] } },
                        lowStock: { $sum: { $cond: [{ $lt: ["$quantity", 5] }, 1, 0] } }
                    }
                }
            ])
        ]);

        res.json({
            status: true,
            data: {
                customerId: cid,
                summary: aggregate[0] || { totalItems: 0, totalValue: 0, totalQuantity: 0, outOfStock: 0, lowStock: 0 },
                items
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * تقرير الأرباح مع فلتر تاريخي
 * GET /api/reports/profit?from=2024-01-01&to=2024-12-31
 */
exports.getProfitReport = async (req, res) => {
    try {
        const cid = req.customerId;
        const { from, to } = req.query;

        const salesFilter = { customerId: cid };
        if (from || to) {
            salesFilter.createdAt = {};
            if (from) salesFilter.createdAt.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                salesFilter.createdAt.$lt = toDate;
            }
        }

        const returnFilter = { customerId: cid };
        if (from || to) {
            returnFilter.date = {};
            if (from) returnFilter.date.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                returnFilter.date.$lt = toDate;
            }
        }

        const expenseFilter = { customerId: cid };
        if (from || to) {
            expenseFilter.date = {};
            if (from) expenseFilter.date.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                expenseFilter.date.$lt = toDate;
            }
        }

        const purchaseInvoiceFilter = { customerId: cid, status: 'posted' };
        if (from || to) {
            purchaseInvoiceFilter.date = {};
            if (from) purchaseInvoiceFilter.date.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                purchaseInvoiceFilter.date.$lt = toDate;
            }
        }

        const [purchaseInvoicesAgg, salesAgg, cogsAgg, returnsAgg, returnsCOGSAgg, expensesAgg] = await Promise.all([
            PurchaseInvoice.aggregate([
                { $match: purchaseInvoiceFilter },
                { $group: { _id: null, total: { $sum: "$grandTotal" } } }
            ]),
            SaleInvoice.aggregate([
                { $match: salesFilter },
                { $group: { _id: null, total: { $sum: "$total" } } }
            ]),
            SaleInvoice.aggregate([
                { $match: salesFilter },
                    { $group: { _id: null, total: { $sum: { $ifNull: ["$totalCost", { $multiply: ["$quantity", "$costPrice"] }] } } } }
            ]),
            Return.aggregate([
                { $match: returnFilter },
                { $group: { _id: null, total: { $sum: "$total" } } }
            ]),
            Return.aggregate([
                { $match: returnFilter },
                    { $group: { _id: null, total: { $sum: { $ifNull: ["$totalCost", { $multiply: ["$quantity", "$costPrice"] }] } } } }
            ]),
            Expense.aggregate([
                { $match: expenseFilter },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ])
        ]);

        const totalPurchases = purchaseInvoicesAgg[0]?.total || 0;
        const grossSales = salesAgg[0]?.total || 0;
        const totalReturns = returnsAgg[0]?.total || 0;
        const totalSales = grossSales - totalReturns;
        const totalExpenses = expensesAgg[0]?.total || 0;
        const grossCOGS = cogsAgg[0]?.total || 0;
        const returnsCOGS = returnsCOGSAgg[0]?.total || 0;
        const totalCOGS = grossCOGS - returnsCOGS;
        const grossProfit = totalSales - totalCOGS;
        const netProfit = grossProfit - totalExpenses;
        const profitMargin = totalSales > 0 ? ((netProfit / totalSales) * 100).toFixed(2) : 0;

        res.json({
            status: true,
            data: {
                customerId: cid,
                period: { from: from || 'All time', to: to || 'Now' },
                totalSales,
                grossSales,
                totalReturns,
                totalPurchases,
                totalCOGS,
                grossCOGS,
                returnsCOGS,
                totalExpenses,
                grossProfit,
                netProfit,
                profitMarginPercent: parseFloat(profitMargin)
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
