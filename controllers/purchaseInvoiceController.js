const mongoose = require('mongoose');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const Supplier = require('../models/Supplier');
const Item = require('../models/Item');
const StockMovement = require('../models/StockMovement');
const { computePaymentStatus } = require('../utils/paymentStatus');

const formatInvoiceNumber = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
    return `PI-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;
};

const computeTotals = ({ items, tax = 0, discount = 0 }) => {
    const normalized = items.map((it) => {
        const qty = Number(it.qty);
        const unitCost = Number(it.unitCost);
        const lineTotal = qty * unitCost;
        return { ...it, qty, unitCost, lineTotal };
    });
    const subTotal = normalized.reduce((sum, it) => sum + it.lineTotal, 0);
    const grandTotal = subTotal + Number(tax || 0) - Number(discount || 0);
    return { items: normalized, subTotal, grandTotal };
};

const reverseWeightedAverage = ({ oldStock, oldAvgCost, qty, unitCost }) => {
    const newStock = oldStock - qty;
    if (newStock <= 0) return { newStock, newAvgCost: 0 };
    const newAvgCost = ((oldStock * oldAvgCost) - (qty * unitCost)) / newStock;
    return { newStock, newAvgCost: Math.max(0, newAvgCost) };
};

exports.createPurchaseInvoice = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { supplierId, date, items, tax = 0, discount = 0, paidAmount = 0 } = req.body;
        const invoiceNumber = req.body.invoiceNumber || formatInvoiceNumber();

        if (!mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.status(400).json({ status: false, message: 'Invalid supplierId', data: null });
        }

        const supplier = await Supplier.findOne({ _id: supplierId, customerId: req.customerId }).session(session);
        if (!supplier) {
            return res.status(404).json({ status: false, message: 'Supplier not found', data: null });
        }

        const { items: normalizedItems, subTotal, grandTotal } = computeTotals({ items, tax, discount });
        if (grandTotal < 0) {
            return res.status(400).json({ status: false, message: 'Invalid totals', data: null });
        }
        const finalPaidAmount = Number(paidAmount);
        if (finalPaidAmount > grandTotal) {
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed grand total', data: null });
        }
        const paymentStatus = computePaymentStatus(grandTotal, finalPaidAmount);

        const invoice = await PurchaseInvoice.create(
            [
                {
                    customerId: req.customerId,
                    invoiceNumber,
                    supplierId,
                    date: date ? new Date(date) : new Date(),
                    status: 'posted',
                    items: normalizedItems.map((it) => ({
                        itemId: it.itemId,
                        qty: it.qty,
                        unitCost: it.unitCost,
                        lineTotal: it.lineTotal,
                    })),
                    subTotal,
                    tax,
                    discount,
                    grandTotal,
                    paidAmount: finalPaidAmount,
                    paymentStatus,
                }
            ],
            { session }
        );

        const createdInvoice = invoice[0];

        for (const line of normalizedItems) {
            if (!mongoose.Types.ObjectId.isValid(line.itemId)) {
                await session.abortTransaction();
                return res.status(400).json({ status: false, message: 'Invalid itemId', data: null });
            }

            const item = await Item.findOne({ _id: line.itemId, customerId: req.customerId }).session(session);
            if (!item) {
                await session.abortTransaction();
                return res.status(404).json({ status: false, message: 'Item not found', data: null });
            }

            const oldTotalCost = Number(item.quantity) * Number(item.costPrice);
            const purchaseAmount = Number(line.qty) * Number(line.unitCost);
            const newQuantity = Number(item.quantity) + Number(line.qty);
            const newTotalCost = oldTotalCost + purchaseAmount;
            const newCostPrice = newQuantity > 0 ? newTotalCost / newQuantity : 0;

            item.quantity = newQuantity;
            item.costPrice = newCostPrice;
            await item.save({ session });

            await StockMovement.create(
                [
                    {
                        customerId: req.customerId,
                        itemId: item._id,
                        qty: Number(line.qty),
                        direction: 'IN',
                        reason: 'PURCHASE',
                        referenceType: 'PURCHASE_INVOICE',
                        referenceId: createdInvoice._id,
                        unitCost: Number(line.unitCost),
                        date: createdInvoice.date,
                    }
                ],
                { session }
            );
        }

        const remainingDebt = Number(grandTotal) - Number(paidAmount);
        if (remainingDebt !== 0) {
            await Supplier.updateOne(
                { _id: supplierId, customerId: req.customerId },
                { $inc: { balance: remainingDebt } },
                { session }
            );
        }

        await session.commitTransaction();
        return res.status(201).json({ status: true, message: 'Purchase invoice created', data: createdInvoice });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.createPurchaseInvoiceNoTx(req, res);
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

exports.createPurchaseInvoiceNoTx = async (req, res) => {
    try {
        const { supplierId, date, items, tax = 0, discount = 0, paidAmount = 0 } = req.body;
        const invoiceNumber = req.body.invoiceNumber || formatInvoiceNumber();

        if (!mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.status(400).json({ status: false, message: 'Invalid supplierId', data: null });
        }

        const supplier = await Supplier.findOne({ _id: supplierId, customerId: req.customerId }).lean();
        if (!supplier) {
            return res.status(404).json({ status: false, message: 'Supplier not found', data: null });
        }

        const { items: normalizedItems, subTotal, grandTotal } = computeTotals({ items, tax, discount });
        if (grandTotal < 0) {
            return res.status(400).json({ status: false, message: 'Invalid totals', data: null });
        }
        const finalPaidAmount = Number(paidAmount);
        if (finalPaidAmount > grandTotal) {
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed grand total', data: null });
        }
        const paymentStatus = computePaymentStatus(grandTotal, finalPaidAmount);

        const createdInvoice = await PurchaseInvoice.create({
            customerId: req.customerId,
            invoiceNumber,
            supplierId,
            date: date ? new Date(date) : new Date(),
            status: 'posted',
            items: normalizedItems.map((it) => ({
                itemId: it.itemId,
                qty: it.qty,
                unitCost: it.unitCost,
                lineTotal: it.lineTotal,
            })),
            subTotal,
            tax,
            discount,
            grandTotal,
            paidAmount: finalPaidAmount,
            paymentStatus,
        });

        for (const line of normalizedItems) {
            if (!mongoose.Types.ObjectId.isValid(line.itemId)) {
                return res.status(400).json({ status: false, message: 'Invalid itemId', data: null });
            }

            const item = await Item.findOne({ _id: line.itemId, customerId: req.customerId });
            if (!item) {
                return res.status(404).json({ status: false, message: 'Item not found', data: null });
            }

            const oldTotalCost = Number(item.quantity) * Number(item.costPrice);
            const purchaseAmount = Number(line.qty) * Number(line.unitCost);
            const newQuantity = Number(item.quantity) + Number(line.qty);
            const newTotalCost = oldTotalCost + purchaseAmount;
            const newCostPrice = newQuantity > 0 ? newTotalCost / newQuantity : 0;

            item.quantity = newQuantity;
            item.costPrice = newCostPrice;
            await item.save();

            await StockMovement.create({
                customerId: req.customerId,
                itemId: item._id,
                qty: Number(line.qty),
                direction: 'IN',
                reason: 'PURCHASE',
                referenceType: 'PURCHASE_INVOICE',
                referenceId: createdInvoice._id,
                unitCost: Number(line.unitCost),
                date: createdInvoice.date,
            });
        }

        const remainingDebt = Number(grandTotal) - Number(paidAmount);
        if (remainingDebt !== 0) {
            await Supplier.updateOne(
                { _id: supplierId, customerId: req.customerId },
                { $inc: { balance: remainingDebt } }
            );
        }

        return res.status(201).json({ status: true, message: 'Purchase invoice created', data: createdInvoice });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.listPurchaseInvoices = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const filter = { customerId: req.customerId };

        const [data, total] = await Promise.all([
            PurchaseInvoice.find(filter)
                .populate('supplierId')
                .sort({ date: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            PurchaseInvoice.countDocuments(filter)
        ]);

        res.status(200).json({
            status: true,
            message: 'Purchase invoices',
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

exports.getPurchaseInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid id', data: null });
        }

        const doc = await PurchaseInvoice.findOne({ _id: id, customerId: req.customerId })
            .populate('supplierId')
            .populate('items.itemId')
            .lean();
        if (!doc) return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });

        res.status(200).json({ status: true, message: 'Purchase invoice', data: doc });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.cancelPurchaseInvoice = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid id', data: null });
        }

        const invoice = await PurchaseInvoice.findOne({ _id: id, customerId: req.customerId }).session(session);
        if (!invoice) {
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }
        if (invoice.status === 'cancelled') {
            return res.status(400).json({ status: false, message: 'Invoice already cancelled', data: null });
        }

        for (const line of invoice.items) {
            const hasLaterMovements = await StockMovement.exists({
                customerId: req.customerId,
                itemId: line.itemId,
                date: { $gt: invoice.date },
            }).session(session);
            if (hasLaterMovements) {
                await session.abortTransaction();
                return res.status(409).json({
                    status: false,
                    message: 'Cannot cancel invoice because there are later stock movements for one or more items',
                    data: null
                });
            }
        }

        for (const line of invoice.items) {
            const item = await Item.findOne({ _id: line.itemId, customerId: req.customerId }).session(session);
            if (!item) {
                await session.abortTransaction();
                return res.status(404).json({ status: false, message: 'Item not found', data: null });
            }

            const oldStock = Number(item.quantity);
            const oldAvgCost = Number(item.costPrice);
            const qty = Number(line.qty);
            const unitCost = Number(line.unitCost);
            const { newStock, newAvgCost } = reverseWeightedAverage({ oldStock, oldAvgCost, qty, unitCost });

            if (newStock < 0) {
                await session.abortTransaction();
                return res.status(409).json({ status: false, message: 'Cannot cancel invoice because stock would become negative', data: null });
            }

            item.quantity = newStock;
            item.costPrice = newAvgCost;
            await item.save({ session });

            await StockMovement.create(
                [
                    {
                        customerId: req.customerId,
                        itemId: item._id,
                        qty,
                        direction: 'OUT',
                        reason: 'PURCHASE_CANCEL',
                        referenceType: 'PURCHASE_INVOICE',
                        referenceId: invoice._id,
                        unitCost,
                        date: new Date(),
                    }
                ],
                { session }
            );
        }

        const remainingDebt = Number(invoice.grandTotal) - Number(invoice.paidAmount);
        if (remainingDebt !== 0) {
            await Supplier.updateOne(
                { _id: invoice.supplierId, customerId: req.customerId },
                { $inc: { balance: -remainingDebt } },
                { session }
            );
        }

        invoice.status = 'cancelled';
        invoice.cancelledAt = new Date();
        invoice.cancelledBy = req.user?._id;
        await invoice.save({ session });

        await session.commitTransaction();
        return res.status(200).json({ status: true, message: 'Purchase invoice cancelled', data: invoice });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.cancelPurchaseInvoiceNoTx(req, res);
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

exports.updatePurchaseInvoice = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { id } = req.params;
        const { supplierId, date, items, tax, discount, paidAmount } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Invalid id', data: null });
        }

        const invoice = await PurchaseInvoice.findOne({ _id: id, customerId: req.customerId }).session(session);
        if (!invoice) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }
        if (invoice.status === 'cancelled') {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Cannot update cancelled invoice', data: null });
        }

        let finalSupplierId = invoice.supplierId;
        if (supplierId !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(supplierId)) {
                await session.abortTransaction();
                return res.status(400).json({ status: false, message: 'Invalid supplierId', data: null });
            }
            const supplier = await Supplier.findOne({ _id: supplierId, customerId: req.customerId }).session(session);
            if (!supplier) {
                await session.abortTransaction();
                return res.status(404).json({ status: false, message: 'Supplier not found', data: null });
            }
            finalSupplierId = supplierId;
        }

        let finalItems = invoice.items;
        let finalSubTotal = invoice.subTotal;
        let finalGrandTotal = invoice.grandTotal;
        let finalTax = invoice.tax;
        let finalDiscount = invoice.discount;
        if (items !== undefined) {
            const { items: normalizedItems, subTotal, grandTotal } = computeTotals({ 
                items, 
                tax: tax ?? invoice.tax, 
                discount: discount ?? invoice.discount 
            });
            if (grandTotal < 0) {
                await session.abortTransaction();
                return res.status(400).json({ status: false, message: 'Invalid totals', data: null });
            }
            finalItems = normalizedItems;
            finalSubTotal = subTotal;
            finalGrandTotal = grandTotal;
            finalTax = tax ?? invoice.tax;
            finalDiscount = discount ?? invoice.discount;
        } else {
            if (tax !== undefined || discount !== undefined) {
                finalTax = tax ?? invoice.tax;
                finalDiscount = discount ?? invoice.discount;
                finalSubTotal = invoice.subTotal;
                finalGrandTotal = finalSubTotal + Number(finalTax) - Number(finalDiscount);
                if (finalGrandTotal < 0) {
                    await session.abortTransaction();
                    return res.status(400).json({ status: false, message: 'Invalid totals', data: null });
                }
            }
        }

        const finalPaidAmount = paidAmount !== undefined ? Number(paidAmount) : invoice.paidAmount;
        if (finalPaidAmount > finalGrandTotal) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed grand total', data: null });
        }
        const paymentStatus = computePaymentStatus(finalGrandTotal, finalPaidAmount);

        const oldRemainingDebt = Number(invoice.grandTotal) - Number(invoice.paidAmount);
        const newRemainingDebt = finalGrandTotal - finalPaidAmount;
        const debtDelta = newRemainingDebt - oldRemainingDebt;
        if (debtDelta !== 0) {
            await Supplier.updateOne(
                { _id: invoice.supplierId, customerId: req.customerId },
                { $inc: { balance: debtDelta } },
                { session }
            );
        }

        invoice.supplierId = finalSupplierId;
        invoice.date = date ? new Date(date) : invoice.date;
        invoice.items = finalItems.map((it) => ({
            itemId: it.itemId,
            qty: it.qty,
            unitCost: it.unitCost,
            lineTotal: it.lineTotal,
        }));
        invoice.subTotal = finalSubTotal;
        invoice.tax = finalTax;
        invoice.discount = finalDiscount;
        invoice.grandTotal = finalGrandTotal;
        invoice.paidAmount = finalPaidAmount;
        invoice.paymentStatus = paymentStatus;
        await invoice.save({ session });

        await session.commitTransaction();
        return res.status(200).json({ status: true, message: 'Purchase invoice updated', data: invoice });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.updatePurchaseInvoiceNoTx(req, res);
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

exports.updatePurchaseInvoiceNoTx = async (req, res) => {
    try {
        const { id } = req.params;
        const { supplierId, date, items, tax, discount, paidAmount } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid id', data: null });
        }

        const invoice = await PurchaseInvoice.findOne({ _id: id, customerId: req.customerId });
        if (!invoice) {
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }
        if (invoice.status === 'cancelled') {
            return res.status(400).json({ status: false, message: 'Cannot update cancelled invoice', data: null });
        }

        let finalSupplierId = invoice.supplierId;
        if (supplierId !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(supplierId)) {
                return res.status(400).json({ status: false, message: 'Invalid supplierId', data: null });
            }
            const supplier = await Supplier.findOne({ _id: supplierId, customerId: req.customerId });
            if (!supplier) {
                return res.status(404).json({ status: false, message: 'Supplier not found', data: null });
            }
            finalSupplierId = supplierId;
        }

        let finalItems = invoice.items;
        let finalSubTotal = invoice.subTotal;
        let finalGrandTotal = invoice.grandTotal;
        let finalTax = invoice.tax;
        let finalDiscount = invoice.discount;
        if (items !== undefined) {
            const { items: normalizedItems, subTotal, grandTotal } = computeTotals({ 
                items, 
                tax: tax ?? invoice.tax, 
                discount: discount ?? invoice.discount 
            });
            if (grandTotal < 0) {
                return res.status(400).json({ status: false, message: 'Invalid totals', data: null });
            }
            finalItems = normalizedItems;
            finalSubTotal = subTotal;
            finalGrandTotal = grandTotal;
            finalTax = tax ?? invoice.tax;
            finalDiscount = discount ?? invoice.discount;
        } else {
            if (tax !== undefined || discount !== undefined) {
                finalTax = tax ?? invoice.tax;
                finalDiscount = discount ?? invoice.discount;
                finalSubTotal = invoice.subTotal;
                finalGrandTotal = finalSubTotal + Number(finalTax) - Number(finalDiscount);
                if (finalGrandTotal < 0) {
                    return res.status(400).json({ status: false, message: 'Invalid totals', data: null });
                }
            }
        }

        const finalPaidAmount = paidAmount !== undefined ? Number(paidAmount) : invoice.paidAmount;
        if (finalPaidAmount > finalGrandTotal) {
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed grand total', data: null });
        }
        const paymentStatus = computePaymentStatus(finalGrandTotal, finalPaidAmount);

        const oldRemainingDebt = Number(invoice.grandTotal) - Number(invoice.paidAmount);
        const newRemainingDebt = finalGrandTotal - finalPaidAmount;
        const debtDelta = newRemainingDebt - oldRemainingDebt;
        if (debtDelta !== 0) {
            await Supplier.updateOne(
                { _id: invoice.supplierId, customerId: req.customerId },
                { $inc: { balance: debtDelta } }
            );
        }

        invoice.supplierId = finalSupplierId;
        invoice.date = date ? new Date(date) : invoice.date;
        invoice.items = finalItems.map((it) => ({
            itemId: it.itemId,
            qty: it.qty,
            unitCost: it.unitCost,
            lineTotal: it.lineTotal,
        }));
        invoice.subTotal = finalSubTotal;
        invoice.tax = finalTax;
        invoice.discount = finalDiscount;
        invoice.grandTotal = finalGrandTotal;
        invoice.paidAmount = finalPaidAmount;
        invoice.paymentStatus = paymentStatus;
        await invoice.save();

        return res.status(200).json({ status: true, message: 'Purchase invoice updated', data: invoice });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.cancelPurchaseInvoiceNoTx = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid id', data: null });
        }

        const invoice = await PurchaseInvoice.findOne({ _id: id, customerId: req.customerId });
        if (!invoice) {
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }
        if (invoice.status === 'cancelled') {
            return res.status(400).json({ status: false, message: 'Invoice already cancelled', data: null });
        }

        for (const line of invoice.items) {
            const hasLaterMovements = await StockMovement.exists({
                customerId: req.customerId,
                itemId: line.itemId,
                date: { $gt: invoice.date },
            });
            if (hasLaterMovements) {
                return res.status(409).json({
                    status: false,
                    message: 'Cannot cancel invoice because there are later stock movements for one or more items',
                    data: null
                });
            }
        }

        for (const line of invoice.items) {
            const item = await Item.findOne({ _id: line.itemId, customerId: req.customerId });
            if (!item) {
                return res.status(404).json({ status: false, message: 'Item not found', data: null });
            }

            const oldStock = Number(item.quantity);
            const oldAvgCost = Number(item.costPrice);
            const qty = Number(line.qty);
            const unitCost = Number(line.unitCost);
            const { newStock, newAvgCost } = reverseWeightedAverage({ oldStock, oldAvgCost, qty, unitCost });

            if (newStock < 0) {
                return res.status(409).json({ status: false, message: 'Cannot cancel invoice because stock would become negative', data: null });
            }

            item.quantity = newStock;
            item.costPrice = newAvgCost;
            await item.save();

            await StockMovement.create({
                customerId: req.customerId,
                itemId: item._id,
                qty,
                direction: 'OUT',
                reason: 'PURCHASE_CANCEL',
                referenceType: 'PURCHASE_INVOICE',
                referenceId: invoice._id,
                unitCost,
                date: new Date(),
            });
        }

        const remainingDebt = Number(invoice.grandTotal) - Number(invoice.paidAmount);
        if (remainingDebt !== 0) {
            await Supplier.updateOne(
                { _id: invoice.supplierId, customerId: req.customerId },
                { $inc: { balance: -remainingDebt } }
            );
        }

        invoice.status = 'cancelled';
        invoice.cancelledAt = new Date();
        invoice.cancelledBy = req.user?._id;
        await invoice.save();

        return res.status(200).json({ status: true, message: 'Purchase invoice cancelled', data: invoice });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getPurchaseInvoicesBySupplier = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const filter = { customerId: req.customerId, supplierId };

        const [data, total] = await Promise.all([
            PurchaseInvoice.find(filter)
                .populate('supplierId')
                .sort({ date: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            PurchaseInvoice.countDocuments(filter)
        ]);

        res.status(200).json({
            status: true,
            message: 'Purchase invoices by supplier',
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
