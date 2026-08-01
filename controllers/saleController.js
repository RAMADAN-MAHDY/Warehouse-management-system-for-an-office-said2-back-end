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

const formatGroupId = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
    return `SG-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;
};

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

        // تحديث رصيد العميل بالمبلغ المتبقي (الدين الجديد)
        const remainingDebt = total - paidAmount;
        if (clientIdToSave && remainingDebt > 0) {
            await mongoose.model('Client').updateOne(
                { _id: clientIdToSave, customerId: req.customerId },
                { $inc: { balance: remainingDebt } },
                { session }
            );
        }

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
            resolvedClientName = clientExists.name;
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

        // تحديث رصيد العميل بالمبلغ المتبقي (الدين الجديد)
        const remainingDebtNoTx = total - paidAmount;
        if (clientIdToSave && remainingDebtNoTx > 0) {
            await mongoose.model('Client').updateOne(
                { _id: clientIdToSave, customerId: req.customerId },
                { $inc: { balance: remainingDebtNoTx } }
            );
        }

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

        // ── تحديث رصيد العميل ──
        // يجب حسابه هنا (قبل sale.save) لأننا نحتاج القيم القديمة من `before`
        const oldRemainingDebt = Number(before.total) - Number(before.paidAmount);
        const newRemainingDebt = total - paidAmount;
        const oldClientId = before.clientId;
        const newClientId = clientIdToSave;
        const clientChanged = String(oldClientId || '') !== String(newClientId || '');

        if (!clientChanged) {
            // نفس العميل — نحسب الفرق فقط
            const debtDelta = newRemainingDebt - oldRemainingDebt;
            if (debtDelta !== 0 && newClientId) {
                await mongoose.model('Client').updateOne(
                    { _id: newClientId, customerId: req.customerId },
                    { $inc: { balance: debtDelta } },
                    { session }
                );
            }
        } else {
            // العميل تغيّر — نُعيد الدين للقديم ونُضيفه للجديد
            if (oldClientId && oldRemainingDebt > 0) {
                await mongoose.model('Client').updateOne(
                    { _id: oldClientId, customerId: req.customerId },
                    { $inc: { balance: -oldRemainingDebt } },
                    { session }
                );
            }
            if (newClientId && newRemainingDebt > 0) {
                await mongoose.model('Client').updateOne(
                    { _id: newClientId, customerId: req.customerId },
                    { $inc: { balance: newRemainingDebt } },
                    { session }
                );
            }
        }

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

        // ── تحديث رصيد العميل ──
        const oldRemainingDebtNoTx = Number(before.total) - Number(before.paidAmount);
        const newRemainingDebtNoTx = total - paidAmount;
        const oldClientIdNoTx = before.clientId;
        const newClientIdNoTx = clientIdToSave;
        const clientChangedNoTx = String(oldClientIdNoTx || '') !== String(newClientIdNoTx || '');

        if (!clientChangedNoTx) {
            const debtDeltaNoTx = newRemainingDebtNoTx - oldRemainingDebtNoTx;
            if (debtDeltaNoTx !== 0 && newClientIdNoTx) {
                await mongoose.model('Client').updateOne(
                    { _id: newClientIdNoTx, customerId: req.customerId },
                    { $inc: { balance: debtDeltaNoTx } }
                );
            }
        } else {
            if (oldClientIdNoTx && oldRemainingDebtNoTx > 0) {
                await mongoose.model('Client').updateOne(
                    { _id: oldClientIdNoTx, customerId: req.customerId },
                    { $inc: { balance: -oldRemainingDebtNoTx } }
                );
            }
            if (newClientIdNoTx && newRemainingDebtNoTx > 0) {
                await mongoose.model('Client').updateOne(
                    { _id: newClientIdNoTx, customerId: req.customerId },
                    { $inc: { balance: newRemainingDebtNoTx } }
                );
            }
        }

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

        // تراجع رصيد العميل عند الحذف (الدين المتبقي يُعاد للحالة السابقة)
        const remainingDebtOnDelete = Number(sale.total) - Number(sale.paidAmount);
        if (sale.clientId && remainingDebtOnDelete > 0) {
            await mongoose.model('Client').updateOne(
                { _id: sale.clientId, customerId: req.customerId },
                { $inc: { balance: -remainingDebtOnDelete } },
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

        // تراجع رصيد العميل عند الحذف
        const remainingDebtOnDeleteNoTx = Number(sale.total) - Number(sale.paidAmount);
        if (sale.clientId && remainingDebtOnDeleteNoTx > 0) {
            await mongoose.model('Client').updateOne(
                { _id: sale.clientId, customerId: req.customerId },
                { $inc: { balance: -remainingDebtOnDeleteNoTx } }
            );
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
                // تراجع رصيد العميل عند الحذف الجماعي
                const remainingDebtBulk = Number(sale.total) - Number(sale.paidAmount);
                if (sale.clientId && remainingDebtBulk > 0) {
                    await mongoose.model('Client').updateOne(
                        { _id: sale.clientId, customerId: req.customerId },
                        { $inc: { balance: -remainingDebtBulk } }
                    );
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

exports.addSaleInvoiceGroup = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { items, sellerName, representativeId, clientName, clientId, paidAmount: reqPaidAmount } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'يجب تقديم قائمة صالحة من المنتجات', data: null });
        }

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
        let resolvedClientName = clientName;
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

        const requestedTotals = {};
        for (const line of items) {
            const m = line.modelNumber;
            requestedTotals[m] = (requestedTotals[m] || 0) + Number(line.quantity);
        }

        const itemDocs = {};
        for (const modelNum of Object.keys(requestedTotals)) {
            const item = await Item.findOne({ modelNumber: modelNum, customerId: req.customerId }).session(session);
            if (!item) {
                await session.abortTransaction();
                return res.status(404).json({ status: false, message: `المنتج (${modelNum}) غير موجود`, data: null });
            }
            if (item.quantity < requestedTotals[modelNum]) {
                await session.abortTransaction();
                return res.status(400).json({
                    status: false,
                    message: `الكمية المتاحة من المنتج (${item.name} - ${modelNum}) غير كافية (المطلوب: ${requestedTotals[modelNum]}، المتاح: ${item.quantity})`,
                    data: null
                });
            }
            itemDocs[modelNum] = item;
        }

        const totalGroupPrice = items.reduce((sum, line) => sum + (Number(line.quantity) * Number(line.price)), 0);
        let remainingInitialPayment = Number(reqPaidAmount || 0);

        if (remainingInitialPayment > totalGroupPrice) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed total', data: null });
        }

        const groupId = formatGroupId();
        const createdInvoices = [];

        for (const line of items) {
            const item = itemDocs[line.modelNumber];
            const lineQty = Number(line.quantity);
            const linePrice = Number(line.price);
            const lineTotal = lineQty * linePrice;
            const unitCost = item.costPrice || item.price || 0;

            item.quantity -= lineQty;
            await item.save({ session });

            const linePaidAmount = Math.min(remainingInitialPayment, lineTotal);
            remainingInitialPayment -= linePaidAmount;

            const paymentStatus = computePaymentStatus(lineTotal, linePaidAmount);

            const invoice = await SaleInvoice.create(
                [
                    {
                        customerId: req.customerId,
                        modelNumber: line.modelNumber,
                        name: line.name,
                        quantity: lineQty,
                        price: linePrice,
                        total: lineTotal,
                        totalCost: lineQty * unitCost,
                        paidAmount: linePaidAmount,
                        paymentStatus,
                        sellerName: resolvedSellerName,
                        clientName: resolvedClientName,
                        clientId: clientIdToSave,
                        representativeId: repIdToSave,
                        costPrice: unitCost,
                        invoiceGroupId: groupId
                    }
                ],
                { session }
            );

            const created = invoice[0];
            createdInvoices.push(created);

            await StockMovement.create(
                [
                    {
                        customerId: req.customerId,
                        itemId: item._id,
                        qty: lineQty,
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

            checkAndNotifyLowStock(item, req.customerId);
        }

        // تحديث رصيد العميل بإجمالي الدين للمجموعة (مرة واحدة فقط)
        const groupRemainingDebt = Math.max(0, totalGroupPrice - Number(reqPaidAmount || 0));
        if (clientIdToSave && groupRemainingDebt > 0) {
            await mongoose.model('Client').updateOne(
                { _id: clientIdToSave, customerId: req.customerId },
                { $inc: { balance: groupRemainingDebt } },
                { session }
            );
        }

        await session.commitTransaction();

        const groupTotals = {
            subTotal: totalGroupPrice,
            grandTotal: totalGroupPrice,
            paidAmount: Number(reqPaidAmount || 0),
            remainingDebt: Math.max(0, totalGroupPrice - Number(reqPaidAmount || 0)),
            itemCount: createdInvoices.length,
            paymentStatus: computePaymentStatus(totalGroupPrice, Number(reqPaidAmount || 0))
        };

        return res.status(201).json({
            status: true,
            message: 'تم إضافة مبيعات المجموعة بنجاح',
            invoiceGroupId: groupId,
            totals: groupTotals,
            data: createdInvoices
        });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.addSaleInvoiceGroupNoTx(req, res);
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

exports.addSaleInvoiceGroupNoTx = async (req, res) => {
    try {
        const { items, sellerName, representativeId, clientName, clientId, paidAmount: reqPaidAmount } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ status: false, message: 'يجب تقديم قائمة صالحة من المنتجات', data: null });
        }

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
        let resolvedClientName = clientName;
        if (clientId) {
            if (!mongoose.Types.ObjectId.isValid(clientId)) {
                return res.status(400).json({ status: false, message: 'Invalid clientId', data: null });
            }
            const clientExists = await mongoose.model('Client').findOne({ _id: clientId, customerId: req.customerId });
            if (!clientExists) {
                return res.status(400).json({ status: false, message: 'العميل المختار غير موجود', data: null });
            }
            clientIdToSave = clientExists._id;
            resolvedClientName = clientExists.name;
        }

        const requestedTotals = {};
        for (const line of items) {
            const m = line.modelNumber;
            requestedTotals[m] = (requestedTotals[m] || 0) + Number(line.quantity);
        }

        const itemDocs = {};
        for (const modelNum of Object.keys(requestedTotals)) {
            const item = await Item.findOne({ modelNumber: modelNum, customerId: req.customerId });
            if (!item) {
                return res.status(404).json({ status: false, message: `المنتج (${modelNum}) غير موجود`, data: null });
            }
            if (item.quantity < requestedTotals[modelNum]) {
                return res.status(400).json({
                    status: false,
                    message: `الكمية المتاحة من المنتج (${item.name} - ${modelNum}) غير كافية (المطلوب: ${requestedTotals[modelNum]}، المتاح: ${item.quantity})`,
                    data: null
                });
            }
            itemDocs[modelNum] = item;
        }

        const totalGroupPrice = items.reduce((sum, line) => sum + (Number(line.quantity) * Number(line.price)), 0);
        let remainingInitialPayment = Number(reqPaidAmount || 0);

        if (remainingInitialPayment > totalGroupPrice) {
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed total', data: null });
        }

        const groupId = formatGroupId();
        const createdInvoices = [];

        for (const line of items) {
            const item = itemDocs[line.modelNumber];
            const lineQty = Number(line.quantity);
            const linePrice = Number(line.price);
            const lineTotal = lineQty * linePrice;
            const unitCost = item.costPrice || item.price || 0;

            item.quantity -= lineQty;
            await item.save();

            const linePaidAmount = Math.min(remainingInitialPayment, lineTotal);
            remainingInitialPayment -= linePaidAmount;

            const paymentStatus = computePaymentStatus(lineTotal, linePaidAmount);

            const created = await SaleInvoice.create({
                customerId: req.customerId,
                modelNumber: line.modelNumber,
                name: line.name,
                quantity: lineQty,
                price: linePrice,
                total: lineTotal,
                totalCost: lineQty * unitCost,
                paidAmount: linePaidAmount,
                paymentStatus,
                sellerName: resolvedSellerName,
                clientName: resolvedClientName,
                clientId: clientIdToSave,
                representativeId: repIdToSave,
                costPrice: unitCost,
                invoiceGroupId: groupId
            });

            createdInvoices.push(created);

            await StockMovement.create({
                customerId: req.customerId,
                itemId: item._id,
                qty: lineQty,
                direction: 'OUT',
                reason: 'SALE',
                referenceType: 'SALE_INVOICE',
                referenceId: created._id,
                unitCost: unitCost,
                date: created.createdAt || new Date(),
            });

            checkAndNotifyLowStock(item, req.customerId);
        }

        // تحديث رصيد العميل بإجمالي الدين للمجموعة (مرة واحدة فقط)
        const groupRemainingDebtNoTx = Math.max(0, totalGroupPrice - Number(reqPaidAmount || 0));
        if (clientIdToSave && groupRemainingDebtNoTx > 0) {
            await mongoose.model('Client').updateOne(
                { _id: clientIdToSave, customerId: req.customerId },
                { $inc: { balance: groupRemainingDebtNoTx } }
            );
        }

        const groupTotals = {
            subTotal: totalGroupPrice,
            grandTotal: totalGroupPrice,
            paidAmount: Number(reqPaidAmount || 0),
            remainingDebt: Math.max(0, totalGroupPrice - Number(reqPaidAmount || 0)),
            itemCount: createdInvoices.length,
            paymentStatus: computePaymentStatus(totalGroupPrice, Number(reqPaidAmount || 0))
        };

        return res.status(201).json({
            status: true,
            message: 'تم إضافة مبيعات المجموعة بنجاح',
            invoiceGroupId: groupId,
            totals: groupTotals,
            data: createdInvoices
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.addGroupPayment = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { groupId } = req.params;
        const { amount, method, referenceNumber, note } = req.body;

        const sales = await SaleInvoice.find({ invoiceGroupId: groupId, customerId: req.customerId })
            .sort({ createdAt: 1 })
            .session(session);

        if (!sales || sales.length === 0) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'مجموعة الفواتير غير موجودة', data: null });
        }

        const totalRemaining = sales.reduce((sum, s) => sum + (Number(s.total) - Number(s.paidAmount || 0)), 0);

        if (Number(amount) <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'المبلغ يجب أن يكون أكبر من صفر', data: null });
        }
        if (Number(amount) > totalRemaining) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'المبلغ المدفوع أكبر من المتبقي', data: null });
        }

        let paymentToDistribute = Number(amount);
        const updatedSales = [];

        for (const s of sales) {
            if (paymentToDistribute <= 0) break;
            const sRemaining = Number(s.total) - Number(s.paidAmount || 0);
            if (sRemaining <= 0) continue;

            const currentPay = Math.min(paymentToDistribute, sRemaining);
            paymentToDistribute -= currentPay;

            const before = s.toObject();
            const newPaidAmount = Number(s.paidAmount || 0) + currentPay;
            s.paidAmount = newPaidAmount;
            s.paymentStatus = computePaymentStatus(s.total, newPaidAmount);
            await s.save({ session });
            updatedSales.push(s);

            await AuditLog.create(
                [
                    {
                        customerId: req.customerId,
                        userId: req.user?._id,
                        performedBy: req.user?.username || req.user?.email || 'unknown',
                        action: 'sale_invoice_payment',
                        referenceType: 'SALE_INVOICE',
                        referenceId: s._id,
                        details: {
                            amount: currentPay,
                            groupTotalPayment: Number(amount),
                            invoiceGroupId: groupId,
                            method: method || 'cash',
                            referenceNumber: referenceNumber || null,
                            note: note || null
                        },
                        changes: { before, after: s.toObject() }
                    }
                ],
                { session }
            );
        }

        const targetClientId = sales.find(s => s.clientId)?.clientId;
        if (targetClientId) {
            await Client.updateOne(
                { _id: targetClientId, customerId: req.customerId },
                { $inc: { balance: -Number(amount) } },
                { session }
            );
        }

        await session.commitTransaction();

        const allSales = await SaleInvoice.find({ invoiceGroupId: groupId, customerId: req.customerId }).lean();
        const totalGrand = allSales.reduce((sum, s) => sum + Number(s.total), 0);
        const totalPaid = allSales.reduce((sum, s) => sum + Number(s.paidAmount || 0), 0);

        const groupTotals = {
            grandTotal: totalGrand,
            paidAmount: totalPaid,
            remainingDebt: Math.max(0, totalGrand - totalPaid),
            itemCount: allSales.length,
            paymentStatus: computePaymentStatus(totalGrand, totalPaid)
        };

        return res.json({
            status: true,
            message: 'تم تسجيل الدفعة على المجموعة بنجاح',
            invoiceGroupId: groupId,
            totals: groupTotals,
            data: allSales
        });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.addGroupPaymentNoTx(req, res);
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

exports.addGroupPaymentNoTx = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { amount, method, referenceNumber, note } = req.body;

        const sales = await SaleInvoice.find({ invoiceGroupId: groupId, customerId: req.customerId })
            .sort({ createdAt: 1 });

        if (!sales || sales.length === 0) {
            return res.status(404).json({ status: false, message: 'مجموعة الفواتير غير موجودة', data: null });
        }

        const totalRemaining = sales.reduce((sum, s) => sum + (Number(s.total) - Number(s.paidAmount || 0)), 0);

        if (Number(amount) <= 0) {
            return res.status(400).json({ status: false, message: 'المبلغ يجب أن يكون أكبر من صفر', data: null });
        }
        if (Number(amount) > totalRemaining) {
            return res.status(400).json({ status: false, message: 'المبلغ المدفوع أكبر من المتبقي', data: null });
        }

        let paymentToDistribute = Number(amount);

        for (const s of sales) {
            if (paymentToDistribute <= 0) break;
            const sRemaining = Number(s.total) - Number(s.paidAmount || 0);
            if (sRemaining <= 0) continue;

            const currentPay = Math.min(paymentToDistribute, sRemaining);
            paymentToDistribute -= currentPay;

            const before = s.toObject();
            const newPaidAmount = Number(s.paidAmount || 0) + currentPay;
            s.paidAmount = newPaidAmount;
            s.paymentStatus = computePaymentStatus(s.total, newPaidAmount);
            await s.save();

            await AuditLog.create({
                customerId: req.customerId,
                userId: req.user?._id,
                performedBy: req.user?.username || req.user?.email || 'unknown',
                action: 'sale_invoice_payment',
                referenceType: 'SALE_INVOICE',
                referenceId: s._id,
                details: {
                    amount: currentPay,
                    groupTotalPayment: Number(amount),
                    invoiceGroupId: groupId,
                    method: method || 'cash',
                    referenceNumber: referenceNumber || null,
                    note: note || null
                },
                changes: { before, after: s.toObject() }
            });
        }

        const targetClientId = sales.find(s => s.clientId)?.clientId;
        if (targetClientId) {
            await Client.updateOne(
                { _id: targetClientId, customerId: req.customerId },
                { $inc: { balance: -Number(amount) } }
            );
        }

        const allSales = await SaleInvoice.find({ invoiceGroupId: groupId, customerId: req.customerId }).lean();
        const totalGrand = allSales.reduce((sum, s) => sum + Number(s.total), 0);
        const totalPaid = allSales.reduce((sum, s) => sum + Number(s.paidAmount || 0), 0);

        const groupTotals = {
            grandTotal: totalGrand,
            paidAmount: totalPaid,
            remainingDebt: Math.max(0, totalGrand - totalPaid),
            itemCount: allSales.length,
            paymentStatus: computePaymentStatus(totalGrand, totalPaid)
        };

        return res.json({
            status: true,
            message: 'تم تسجيل الدفعة على المجموعة بنجاح',
            invoiceGroupId: groupId,
            totals: groupTotals,
            data: allSales
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getSaleInvoiceGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const sales = await SaleInvoice.find({ customerId: req.customerId, invoiceGroupId: groupId })
            .sort({ createdAt: 1 })
            .populate('clientId')
            .populate('representativeId')
            .lean();

        if (!sales || sales.length === 0) {
            return res.status(404).json({ status: false, message: 'مجموعة الفواتير غير موجودة', data: null });
        }

        const totalGrand = sales.reduce((sum, s) => sum + Number(s.total), 0);
        const totalPaid = sales.reduce((sum, s) => sum + Number(s.paidAmount || 0), 0);

        const groupTotals = {
            subTotal: totalGrand,
            grandTotal: totalGrand,
            paidAmount: totalPaid,
            remainingDebt: Math.max(0, totalGrand - totalPaid),
            itemCount: sales.length,
            paymentStatus: computePaymentStatus(totalGrand, totalPaid)
        };

        return res.status(200).json({
            status: true,
            message: 'فواتير المجموعة',
            invoiceGroupId: groupId,
            totals: groupTotals,
            data: sales
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};
