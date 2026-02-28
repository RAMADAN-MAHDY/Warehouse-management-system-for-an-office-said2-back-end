const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Expense = require('../models/Expense');
const Purchase = require('../models/Purchase');

/**
 * ملخص شامل للعميل الحالي
 * GET /api/reports/summary
 */
exports.getSummary = async (req, res) => {
    try {
        const cid = req.customerId;

        const [
            totalItemsCount,
            totalPurchasesAgg,
            totalSalesAgg,
            expensesList,
            recentSales,
            lowStockItems
        ] = await Promise.all([
            Item.countDocuments({ customerId: cid }),
            Purchase.aggregate([
                { $match: { customerId: cid } },
                { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
            ]),
            SaleInvoice.aggregate([
                { $match: { customerId: cid } },
                { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } }
            ]),
            Expense.find({ customerId: cid }),
            SaleInvoice.find({ customerId: cid }).sort({ createdAt: -1 }).limit(5),
            Item.find({ customerId: cid, quantity: { $lt: 5 } }).limit(10)
        ]);

        const totalExpenses = expensesList.reduce((sum, e) => sum + e.amount, 0);
        const totalSales = totalSalesAgg[0]?.total || 0;
        const totalPurchases = totalPurchasesAgg[0]?.total || 0;
        const netProfit = totalSales - totalPurchases - totalExpenses;

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
                    salesCount: totalSalesAgg[0]?.count || 0,
                    totalPurchases,
                    purchasesCount: totalPurchasesAgg[0]?.count || 0,
                    totalExpenses,
                    netProfit
                },
                recentSales
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.getProfitSummaryJson = async (req, res) => {
    try {
        const cid = req.customerId;
        const purchases = await Purchase.find({ customerId: cid }).sort({ date: -1 }).limit(100);
        const totalPurchasesAgg = await Purchase.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalSales = await SaleInvoice.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: "$total" } } }
        ]);

        const totalCOGS = await SaleInvoice.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: { $multiply: ["$quantity", "$costPrice"] } } } }
        ]);

        const expenses = await Expense.find({ customerId: cid }).sort({ date: -1 });
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);

        const netProfit = (totalSales[0]?.total || 0) - (totalCOGS[0]?.total || 0) - totalExpenses;

        res.json({
            status: true,
            data: {
                totalPurchases: totalPurchasesAgg[0]?.total || 0,
                totalSales: totalSales[0]?.total || 0,
                totalCOGS: totalCOGS[0]?.total || 0,
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

        const [invoices, total, aggregate] = await Promise.all([
            SaleInvoice.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            SaleInvoice.countDocuments(filter),
            SaleInvoice.aggregate([
                { $match: filter },
                { $group: { _id: null, totalRevenue: { $sum: "$total" }, totalQty: { $sum: "$quantity" }, avgPrice: { $avg: "$price" } } }
            ])
        ]);

        res.json({
            status: true,
            data: {
                customerId: cid,
                pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
                summary: {
                    totalRevenue: aggregate[0]?.totalRevenue || 0,
                    totalQuantitySold: aggregate[0]?.totalQty || 0,
                    averagePrice: aggregate[0]?.avgPrice || 0
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
            Item.find(filter).sort({ quantity: 1 }),
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

        const dateFilter = {};
        if (from || to) {
            dateFilter.date = {};
            if (from) dateFilter.date.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                dateFilter.date.$lt = toDate;
            }
        }

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

        const [purchasesAgg, salesAgg, expensesAgg] = await Promise.all([
            Purchase.aggregate([
                { $match: { customerId: cid, ...dateFilter } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            SaleInvoice.aggregate([
                { $match: salesFilter },
                { $group: { _id: null, total: { $sum: "$total" } } }
            ]),
            Expense.aggregate([
                { $match: { customerId: cid, ...dateFilter } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ])
        ]);

        const totalPurchases = purchasesAgg[0]?.total || 0;
        const totalSales = salesAgg[0]?.total || 0;
        const totalExpenses = expensesAgg[0]?.total || 0;
        const grossProfit = totalSales - totalPurchases;
        const netProfit = grossProfit - totalExpenses;
        const profitMargin = totalSales > 0 ? ((netProfit / totalSales) * 100).toFixed(2) : 0;

        res.json({
            status: true,
            data: {
                customerId: cid,
                period: { from: from || 'All time', to: to || 'Now' },
                totalSales,
                totalPurchases,
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
