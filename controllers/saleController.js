const SaleInvoice = require('../models/SaleInvoice');
const Item = require('../models/Item');
const exportExcel = require('../utils/exportExcel');
const InvoiceFile = require('../models/InvoiceFile');
const StockMovement = require('../models/StockMovement');
const Representative = require('../models/Representative');
const Client = require('../models/Client');
const AuditLog = require('../models/AuditLog');
const { computePaymentStatus } = require('../utils/paymentStatus');
const mongoose = require('mongoose');
const { checkAndNotifyLowStock } = require('./notificationController');

exports.exportSalesToExcel = async (req, res) => {
    try {
        const { from, to } = req.query;
        let filter = { customerId: req.customerId };

        if (from || to) {
            const start = from ? new Date(from) : new Date('1970-01-01');
            const end = to ? new Date(to) : new Date();
            end.setHours(23, 59, 59, 999); // End of day
            filter.createdAt = { $gte: start, $lte: end };
        }

        const sales = await SaleInvoice.find(filter).sort({ createdAt: -1 }).populate('clientId').populate('representativeId').lean();

        const data = sales.map(sale => ({
            'رقم الفاتورة': sale._id.toString(),
            'التاريخ': sale.createdAt ? sale.createdAt.toISOString().slice(0, 10) : '',
            'اسم العميل': (sale.clientId && sale.clientId.name) || 'N/A',
            'اسم المندوب': (sale.representativeId && sale.representativeId.name) || sale.sellerName || 'N/A',
            'المنتج': sale.name,
            'الموديل': sale.modelNumber,
            'الكمية': sale.quantity,
            'السعر': sale.price,
            'الإجمالي': sale.total
        }));

        const buffer = exportExcel(data, 'فواتير المبيعات');

        // حفظ نسخة في قاعدة البيانات للرجوع إليها لاحقاً
        await InvoiceFile.create({
            customerId: req.customerId,
            buffer: buffer,
            createdAt: new Date()
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=sales-report.xlsx');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.addSaleInvoice = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { modelNumber, name, quantity, price, sellerName, representativeId, total: frontTotal, paidAmount: reqPaidAmount, clientId } = req.body;

        let repIdToSave;
        let resolvedSellerName = sellerName;
        if (representativeId) {
            if (!mongoose.Types.ObjectId.isValid(representativeId)) {
                await session.abortTransaction();
                return res.status(400).json({ status: false, message: 'Invalid representativeId', data: null });
            }
            const rep = await Representative.findOne({ _id: representativeId, customerId: req.customerId, isActive: true }).session(session);
            if (!rep) {
                await session.abortTransaction();
                return res.status(400).json({ status: false, message: 'المندوب غير موجود أو غير نشط', data: null });
            }
            repIdToSave = rep._id;
            resolvedSellerName = rep.name;
        }

        let clientIdToSave;
        let resolvedClientName = req.body.clientName;
        if (clientId) {
            if (!mongoose.Types.ObjectId.isValid(clientId)) {
                await session.abortTransaction();
                return res.status(400).json({ status: false, message: 'Invalid clientId', data: null });
            }
            const clientExists = await mongoose.model('Client').findOne({ _id: clientId, customerId: req.customerId }).session(session);
            if (!clientExists) {
                await session.abortTransaction();
                return res.status(400).json({ status: false, message: 'العميل المختار غير موجود', data: null });
            }
            clientIdToSave = clientExists._id;
            resolvedClientName = clientExists.name;
        }

        const item = await Item.findOne({ modelNumber, customerId: req.customerId }).session(session);
        if (!item) return res.status(404).json({ status: false, message: 'المنتج غير موجود', data: null });

        if (item.quantity < quantity) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'الكمية غير متوفرة', data: null });
        }

        item.quantity -= quantity;
        await item.save({ session });

        const total = quantity * price;
        const unitCost = item.costPrice || item.price || 0;
        const paidAmount = Number(reqPaidAmount || 0);
        if (paidAmount > total) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed total', data: null });
        }
        const paymentStatus = computePaymentStatus(total, paidAmount);

        const invoice = await SaleInvoice.create(
            [
                {
                    customerId: req.customerId,
                    modelNumber,
                    name,
                    quantity,
                    price,
                    total,
                    totalCost: quantity * unitCost,
                    paidAmount,
                    paymentStatus,
                    sellerName: resolvedSellerName,
                    clientName: resolvedClientName,
                    clientId: clientIdToSave,
                    representativeId: repIdToSave,
                    costPrice: unitCost
                }
            ],
            { session }
        );

        const created = invoice[0];

        await StockMovement.create(
            [
                {
                    customerId: req.customerId,
                    itemId: item._id,
                    qty: Number(quantity),
                    direction: 'OUT',
                    reason: 'SALE',
                    referenceType: 'SALE_INVOICE',
                    referenceId: created._id,
                    unitCost: unitCost,
                    date: created.createdAt || new Date(),
                }
            ],
            { session }
        );

        await session.commitTransaction();
        checkAndNotifyLowStock(item, req.customerId);
        return res.status(201).json({ status: true, message: 'تم إضافة فاتورة البيع', data: created });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.addSaleInvoiceNoTx(req, res);
        }
        try {
            await session.abortTransaction();
        } catch (_) {}
        return res.status(500).json({ status: false, message: error.message, data: null });
    } finally {
        try {
            session.endSession();
        } catch (_) {}
    }
};

exports.addSaleInvoiceNoTx = async (req, res) => {
    try {
        const { modelNumber, name, quantity, price, sellerName, representativeId, total: frontTotal, paidAmount: reqPaidAmount, clientId } = req.body;

        let repIdToSave;
        let resolvedSellerName = sellerName;
        if (representativeId) {
            if (!mongoose.Types.ObjectId.isValid(representativeId)) {
                return res.status(400).json({ status: false, message: 'Invalid representativeId', data: null });
            }
            const rep = await Representative.findOne({ _id: representativeId, customerId: req.customerId, isActive: true });
            if (!rep) {
                return res.status(400).json({ status: false, message: 'المندوب غير موجود أو غير نشط', data: null });
            }
            repIdToSave = rep._id;
            resolvedSellerName = rep.name;
        }

        let clientIdToSave;
        if (clientId) {
            if (!mongoose.Types.ObjectId.isValid(clientId)) {
                return res.status(400).json({ status: false, message: 'Invalid clientId', data: null });
            }
            const clientExists = await mongoose.model('Client').findOne({ _id: clientId, customerId: req.customerId });
            if (!clientExists) {
                return res.status(400).json({ status: false, message: 'العميل المختار غير موجود', data: null });
            }
            clientIdToSave = clientExists._id;
            resolvedSellerName = clientExists.name;
        }

        const item = await Item.findOne({ modelNumber, customerId: req.customerId });
        if (!item) return res.status(404).json({ status: false, message: 'المنتج غير موجود', data: null });

        if (item.quantity < quantity) return res.status(400).json({ status: false, message: 'الكمية غير متوفرة', data: null });
        item.quantity -= quantity;
        await item.save();

        const total = quantity * price;
        const unitCost = item.costPrice || item.price || 0;
        const paidAmount = Number(reqPaidAmount || 0);
        if (paidAmount > total) {
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed total', data: null });
        }
        const paymentStatus = computePaymentStatus(total, paidAmount);

        const created = await SaleInvoice.create({
            customerId: req.customerId,
            modelNumber,
            name,
            quantity,
            price,
            total,
            totalCost: quantity * unitCost,
            paidAmount,
            paymentStatus,
            sellerName: resolvedSellerName,
            clientName: resolvedClientName,
            clientId: clientIdToSave,
            representativeId: repIdToSave,
            costPrice: unitCost
        });

        await StockMovement.create({
            customerId: req.customerId,
            itemId: item._id,
            qty: Number(quantity),
            direction: 'OUT',
            reason: 'SALE',
            referenceType: 'SALE_INVOICE',
            referenceId: created._id,
            unitCost: unitCost,
            date: created.createdAt || new Date(),
        });

        checkAndNotifyLowStock(item, req.customerId);
        return res.status(201).json({ status: true, message: 'تم إضافة فاتورة البيع', data: created });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getSaleInvoiceAuditLogs = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.query;
        const filter = {
            customerId: req.customerId,
            referenceType: 'SALE_INVOICE',
            referenceId: id,
            ...(action ? { action } : {})
        };
        const logs = await AuditLog.find(filter)
            .sort({ at: -1 })
            .lean();

        return res.status(200).json({ status: true, message: 'سجل تدقيق الفاتورة', data: logs });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getSaleInvoices = async (req, res) => {
    try {
        const { day, month, year, from, to, page = 1, limit = 10 } = req.query;
        let filter = { customerId: req.customerId };

        if (day) {
            const start = new Date(day);
            const end = new Date(day);
            end.setDate(end.getDate() + 1);
            filter.createdAt = { $gte: start, $lt: end };
        } else if (month) {
            const [y, m] = month.split('-');
            const start = new Date(y, m - 1, 1);
            const end = new Date(y, m, 1);
            filter.createdAt = { $gte: start, $lt: end };
        } else if (year) {
            const start = new Date(year, 0, 1);
            const end = new Date(Number(year) + 1, 0, 1);
            filter.createdAt = { $gte: start, $lt: end };
        } else if (from || to) {
            const start = from ? new Date(from) : new Date('1970-01-01');
            const end = to ? new Date(to) : new Date();
            end.setDate(end.getDate() + 1);
            filter.createdAt = { $gte: start, $lt: end };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await SaleInvoice.countDocuments(filter);
        const stats = await SaleInvoice.aggregate([
            { $match: filter },
            { $group: { _id: null, totalValue: { $sum: "$total" } } }
        ]);
        const totalSalesValue = stats[0]?.totalValue || 0;

        const invoices = await SaleInvoice.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate('clientId')
            .lean();

        const sales = invoices.map(invoice => ({
            ...invoice,
            customer: (invoice.clientId && invoice.clientId.name) || invoice.sellerName || 'N/A'
        }));

        res.status(200).json({
            status: true,
            message: 'فواتير البيع',
            data: sales,
            totalSalesValue,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({
            status: false,
            message: error.message,
            data: null
        });
    }
};

exports.updateSaleInvoice = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { id } = req.params;
        const { quantity, price, sellerName, clientName, clientId, representativeId, paidAmount: reqPaidAmount } = req.body;

        const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId }).session(session);
        if (!sale) return res.status(404).json({ status: false, message: 'الفاتورة غير موجودة' });

        let repIdToSave = sale.representativeId;
        let resolvedSellerName = sale.sellerName;
        if (representativeId !== undefined) {
            if (representativeId) {
                if (!mongoose.Types.ObjectId.isValid(representativeId)) {
                    await session.abortTransaction();
                    return res.status(400).json({ status: false, message: 'Invalid representativeId' });
                }
                const rep = await Representative.findOne({ _id: representativeId, customerId: req.customerId, isActive: true }).session(session);
                if (!rep) {
                    await session.abortTransaction();
                    return res.status(400).json({ status: false, message: 'المندوب غير موجود أو غير نشط' });
                }
                repIdToSave = rep._id;
                resolvedSellerName = rep.name;
            } else {
                repIdToSave = undefined;
                resolvedSellerName = sellerName !== undefined ? sellerName : '';
            }
        } else if (!sale.representativeId && sellerName !== undefined) {
            resolvedSellerName = sellerName;
        }

        let clientIdToSave = sale.clientId;
        let resolvedClientName = sale.clientName;
        if (clientId !== undefined) {
            if (clientId) {
                if (!mongoose.Types.ObjectId.isValid(clientId)) {
                    await session.abortTransaction();
                    return res.status(400).json({ status: false, message: 'Invalid clientId' });
                }
                const client = await mongoose.model('Client').findOne({ _id: clientId, customerId: req.customerId }).session(session);
                if (!client) {
                    await session.abortTransaction();
                    return res.status(400).json({ status: false, message: 'العميل المختار غير موجود' });
                }
                clientIdToSave = client._id;
                resolvedClientName = client.name;
            } else {
                clientIdToSave = undefined;
                resolvedClientName = clientName !== undefined ? clientName : sale.clientName;
            }
        } else if (!sale.clientId && clientName !== undefined) {
            resolvedClientName = clientName;
        }

        const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId }).session(session);
        if (!item) return res.status(404).json({ status: false, message: 'المنتج غير موجود' });

        const oldQty = Number(sale.quantity);
        const newQty = Number(quantity);
        const delta = newQty - oldQty;

        item.quantity += oldQty;
        if (item.quantity < newQty) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'الكمية غير كافية' });
        }
        item.quantity -= newQty;
        await item.save({ session });

        const total = newQty * Number(price);
        const paidAmount = reqPaidAmount !== undefined ? Number(reqPaidAmount) : sale.paidAmount;
        if (paidAmount > total) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed total' });
        }
        const paymentStatus = computePaymentStatus(total, paidAmount);

        const before = sale.toObject();

        sale.quantity = newQty;
        sale.price = Number(price);
        sale.total = total;
        sale.totalCost = newQty * Number(sale.costPrice || 0);
        sale.paidAmount = paidAmount;
        sale.paymentStatus = paymentStatus;
        sale.sellerName = resolvedSellerName;
        sale.clientName = resolvedClientName;
        sale.clientId = clientIdToSave;
        sale.representativeId = repIdToSave;
        await sale.save({ session });

        await AuditLog.create([
            {
                customerId: req.customerId,
                userId: req.user?._id,
                performedBy: req.user?.username || req.user?.email || 'unknown',
                action: 'update_sale_invoice',
                referenceType: 'SALE_INVOICE',
                referenceId: sale._id,
                details: {
                    reason: req.body.reason || null
                },
                changes: {
                    before,
                    after: sale.toObject()
                }
            }
        ], { session });

        if (delta !== 0) {
            await StockMovement.create(
                [
                    {
                        customerId: req.customerId,
                        itemId: item._id,
                        qty: Math.abs(delta),
                        direction: delta > 0 ? 'OUT' : 'IN',
                        reason: 'ADJUSTMENT',
                        referenceType: 'SALE_INVOICE',
                        referenceId: sale._id,
                        unitCost: Number(sale.costPrice || 0),
                        date: new Date(),
                    }
                ],
                { session }
            );
        }

        await session.commitTransaction();
        return res.json({ status: true, message: 'تم تحديث الفاتورة', data: sale });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.updateSaleInvoiceNoTx(req, res);
        }
        try {
            await session.abortTransaction();
        } catch (_) {}
        return res.status(500).json({ status: false, message: error.message });
    } finally {
        try {
            session.endSession();
        } catch (_) {}
    }
};

exports.updateSaleInvoiceNoTx = async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, price, sellerName, clientName, clientId, representativeId, paidAmount: reqPaidAmount } = req.body;

        const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId });
        if (!sale) return res.status(404).json({ status: false, message: 'الفاتورة غير موجودة' });

        let repIdToSave = sale.representativeId;
        let resolvedSellerName = sale.sellerName;
        if (representativeId !== undefined) {
            if (representativeId) {
                if (!mongoose.Types.ObjectId.isValid(representativeId)) {
                    return res.status(400).json({ status: false, message: 'Invalid representativeId' });
                }
                const rep = await Representative.findOne({ _id: representativeId, customerId: req.customerId, isActive: true });
                if (!rep) {
                    return res.status(400).json({ status: false, message: 'المندوب غير موجود أو غير نشط' });
                }
                repIdToSave = rep._id;
                resolvedSellerName = rep.name;
            } else {
                repIdToSave = undefined;
                resolvedSellerName = sellerName !== undefined ? sellerName : '';
            }
        } else if (!sale.representativeId && sellerName !== undefined) {
            resolvedSellerName = sellerName;
        }

        let clientIdToSave = sale.clientId;
        let resolvedClientName = sale.clientName;
        if (clientId !== undefined) {
            if (clientId) {
                if (!mongoose.Types.ObjectId.isValid(clientId)) {
                    return res.status(400).json({ status: false, message: 'Invalid clientId' });
                }
                const client = await mongoose.model('Client').findOne({ _id: clientId, customerId: req.customerId });
                if (!client) {
                    return res.status(400).json({ status: false, message: 'العميل المختار غير موجود' });
                }
                clientIdToSave = client._id;
                resolvedClientName = client.name;
            } else {
                clientIdToSave = undefined;
                resolvedClientName = clientName !== undefined ? clientName : sale.clientName;
            }
        } else if (!sale.clientId && clientName !== undefined) {
            resolvedClientName = clientName;
        }

        const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId });
        if (!item) return res.status(404).json({ status: false, message: 'المنتج غير موجود' });

        const oldQty = Number(sale.quantity);
        const newQty = Number(quantity);
        const delta = newQty - oldQty;

        item.quantity += oldQty;
        if (item.quantity < newQty) {
            return res.status(400).json({ status: false, message: 'الكمية غير كافية' });
        }
        item.quantity -= newQty;
        await item.save();

        const total = newQty * Number(price);
        const paidAmount = reqPaidAmount !== undefined ? Number(reqPaidAmount) : sale.paidAmount;
        if (paidAmount > total) {
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed total' });
        }
        const paymentStatus = computePaymentStatus(total, paidAmount);

        const before = sale.toObject();

        sale.quantity = newQty;
        sale.price = Number(price);
        sale.total = total;
        sale.totalCost = newQty * Number(sale.costPrice || 0);
        sale.paidAmount = paidAmount;
        sale.paymentStatus = paymentStatus;
        sale.sellerName = resolvedSellerName;
        sale.clientName = resolvedClientName;
        sale.clientId = clientIdToSave;
        sale.representativeId = repIdToSave;
        await sale.save();

        await AuditLog.create({
            customerId: req.customerId,
            userId: req.user?._id,
            performedBy: req.user?.username || req.user?.email || 'unknown',
            action: 'update_sale_invoice',
            referenceType: 'SALE_INVOICE',
            referenceId: sale._id,
            details: {
                reason: req.body.reason || null
            },
            changes: {
                before,
                after: sale.toObject()
            }
        });

        if (delta !== 0) {
            await StockMovement.create({
                customerId: req.customerId,
                itemId: item._id,
                qty: Math.abs(delta),
                direction: delta > 0 ? 'OUT' : 'IN',
                reason: 'ADJUSTMENT',
                referenceType: 'SALE_INVOICE',
                referenceId: sale._id,
                unitCost: Number(sale.costPrice || 0),
                date: new Date(),
            });
        }

        return res.json({ status: true, message: 'تم تحديث الفاتورة', data: sale });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message });
    }
};

exports.deleteSaleInvoice = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { id } = req.params;
        const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId }).session(session);
        if (!sale) return res.status(404).json({ status: false, message: 'الفاتورة غير موجودة' });

        const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId }).session(session);
        if (item) {
            item.quantity += Number(sale.quantity);
            await item.save({ session });
            await StockMovement.create(
                [
                    {
                        customerId: req.customerId,
                        itemId: item._id,
                        qty: Number(sale.quantity),
                        direction: 'IN',
                        reason: 'RETURN',
                        referenceType: 'SALE_INVOICE',
                        referenceId: sale._id,
                        unitCost: Number(sale.costPrice || 0),
                        date: new Date(),
                    }
                ],
                { session }
            );
        }

        await SaleInvoice.deleteOne({ _id: id, customerId: req.customerId }).session(session);
        await session.commitTransaction();
        return res.json({ status: true, message: 'تم حذف الفاتورة' });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.deleteSaleInvoiceNoTx(req, res);
        }
        try {
            await session.abortTransaction();
        } catch (_) {}
        return res.status(500).json({ status: false, message: error.message });
    } finally {
        try {
            session.endSession();
        } catch (_) {}
    }
};

exports.deleteSaleInvoiceNoTx = async (req, res) => {
    try {
        const { id } = req.params;
        const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId });
        if (!sale) return res.status(404).json({ status: false, message: 'الفاتورة غير موجودة' });

        const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId });
        if (item) {
            item.quantity += Number(sale.quantity);
            await item.save();
            await StockMovement.create({
                customerId: req.customerId,
                itemId: item._id,
                qty: Number(sale.quantity),
                direction: 'IN',
                reason: 'RETURN',
                referenceType: 'SALE_INVOICE',
                referenceId: sale._id,
                unitCost: Number(sale.costPrice || 0),
                date: new Date(),
            });
        }

        await SaleInvoice.deleteOne({ _id: id, customerId: req.customerId });
        return res.json({ status: true, message: 'تم حذف الفاتورة' });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message });
    }
};

exports.bulkDeleteSaleInvoices = async (req, res) => {
    try {
        const { ids } = req.body;

        for (const id of ids) {
            const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId });
            if (sale) {
                const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId });
                if (item) {
                    item.quantity += sale.quantity;
                    await item.save();
                    await StockMovement.create({
                        customerId: req.customerId,
                        itemId: item._id,
                        qty: Number(sale.quantity),
                        direction: 'IN',
                        reason: 'RETURN',
                        referenceType: 'SALE_INVOICE',
                        referenceId: sale._id,
                        unitCost: Number(sale.costPrice || 0),
                        date: new Date(),
                    });
                }
                await SaleInvoice.findByIdAndDelete(id);
            }
        }

        res.json({ status: true, message: 'تم حذف الفواتير المحددة بنجاح!' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.getSalesByRepresentative = async (req, res) => {
    try {
        const { representativeId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const filter = { customerId: req.customerId, representativeId };

        const [data, total] = await Promise.all([
            SaleInvoice.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            SaleInvoice.countDocuments(filter)
        ]);

        res.status(200).json({
            status: true,
            message: 'Sales by representative',
            data,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.addSaleInvoicePayment = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { id } = req.params;
        const { amount, method, referenceNumber, note } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'الفاتورة غير موجودة', data: null });
        }

        const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId }).session(session);
        if (!sale) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'الفاتورة غير موجودة', data: null });
        }

        const remaining = Number(sale.total) - Number(sale.paidAmount || 0);
        if (Number(amount) <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'المبلغ يجب أن يكون أكبر من صفر', data: null });
        }
        if (Number(amount) > remaining) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'المبلغ المدفوع أكبر من المتبقي', data: null });
        }

        const before = sale.toObject();
        const newPaidAmount = Number(sale.paidAmount || 0) + Number(amount);
        sale.paidAmount = newPaidAmount;
        sale.paymentStatus = computePaymentStatus(sale.total, newPaidAmount);
        await sale.save({ session });

        if (sale.clientId) {
            await Client.updateOne(
                { _id: sale.clientId, customerId: req.customerId },
                { $inc: { balance: -Number(amount) } },
                { session }
            );
        }

        await AuditLog.create(
            [
                {
                    customerId: req.customerId,
                    userId: req.user?._id,
                    performedBy: req.user?.username || req.user?.email || 'unknown',
                    action: 'sale_invoice_payment',
                    referenceType: 'SALE_INVOICE',
                    referenceId: sale._id,
                    details: {
                        amount: Number(amount),
                        method: method || 'cash',
                        referenceNumber: referenceNumber || null,
                        note: note || null
                    },
                    changes: { before, after: sale.toObject() }
                }
            ],
            { session }
        );

        await session.commitTransaction();
        return res.json({ status: true, message: 'تم تسجيل الدفعة', data: sale });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.addSaleInvoicePaymentNoTx(req, res);
        }
        try {
            await session.abortTransaction();
        } catch (_) {}
        return res.status(500).json({ status: false, message: error.message, data: null });
    } finally {
        try {
            session.endSession();
        } catch (_) {}
    }
};

exports.addSaleInvoicePaymentNoTx = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, method, referenceNumber, note } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'الفاتورة غير موجودة', data: null });
        }

        const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId });
        if (!sale) {
            return res.status(404).json({ status: false, message: 'الفاتورة غير موجودة', data: null });
        }

        const remaining = Number(sale.total) - Number(sale.paidAmount || 0);
        if (Number(amount) <= 0) {
            return res.status(400).json({ status: false, message: 'المبلغ يجب أن يكون أكبر من صفر', data: null });
        }
        if (Number(amount) > remaining) {
            return res.status(400).json({ status: false, message: 'المبلغ المدفوع أكبر من المتبقي', data: null });
        }

        const before = sale.toObject();
        const newPaidAmount = Number(sale.paidAmount || 0) + Number(amount);
        sale.paidAmount = newPaidAmount;
        sale.paymentStatus = computePaymentStatus(sale.total, newPaidAmount);
        await sale.save();

        if (sale.clientId) {
            await Client.updateOne(
                { _id: sale.clientId, customerId: req.customerId },
                { $inc: { balance: -Number(amount) } }
            );
        }

        await AuditLog.create({
            customerId: req.customerId,
            userId: req.user?._id,
            performedBy: req.user?.username || req.user?.email || 'unknown',
            action: 'sale_invoice_payment',
            referenceType: 'SALE_INVOICE',
            referenceId: sale._id,
            details: {
                amount: Number(amount),
                method: method || 'cash',
                referenceNumber: referenceNumber || null,
                note: note || null
            },
            changes: { before, after: sale.toObject() }
        });

        return res.json({ status: true, message: 'تم تسجيل الدفعة', data: sale });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};
