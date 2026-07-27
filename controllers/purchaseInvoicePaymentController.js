const mongoose = require('mongoose');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const PurchaseInvoicePayment = require('../models/PurchaseInvoicePayment');
const Supplier = require('../models/Supplier');
const { computePaymentStatus } = require('../utils/paymentStatus');

exports.addPayment = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        
        const { id: invoiceId } = req.params;
        const { amount, method = 'cash', referenceNumber, note, date } = req.body;

        if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Invalid invoice ID', data: null });
        }

        // Fetch invoice with tenant isolation
        const invoice = await PurchaseInvoice.findOne({
            _id: invoiceId,
            customerId: req.customerId
        }).session(session);

        if (!invoice) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }

        // Check if invoice is cancelled
        if (invoice.status === 'cancelled') {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Cannot add payment to cancelled invoice', data: null });
        }

        // Calculate remaining debt
        const remainingDebt = Number(invoice.grandTotal) - Number(invoice.paidAmount);

        // Check if payment amount exceeds remaining debt
        if (Number(amount) > remainingDebt) {
            await session.abortTransaction();
            return res.status(400).json({
                status: false,
                message: 'المبلغ المدفوع أكبر من المتبقي',
                data: null
            });
        }

        // Create payment record
        const payment = await PurchaseInvoicePayment.create(
            [
                {
                    customerId: req.customerId,
                    invoiceId,
                    supplierId: invoice.supplierId,
                    amount: Number(amount),
                    method,
                    referenceNumber: referenceNumber || null,
                    note: note || null,
                    date: date ? new Date(date) : new Date(),
                    createdBy: req.user._id,
                    status: 'active'
                }
            ],
            { session }
        );

        const createdPayment = payment[0];

        // Update invoice: increment paid amount
        invoice.paidAmount = Number(invoice.paidAmount) + Number(amount);
        
        // Recalculate payment status
        invoice.paymentStatus = computePaymentStatus(invoice.grandTotal, invoice.paidAmount);
        
        await invoice.save({ session });

        // Update supplier balance: decrease debt
        await Supplier.updateOne(
            { _id: invoice.supplierId, customerId: req.customerId },
            { $inc: { balance: -Number(amount) } },
            { session }
        );

        await session.commitTransaction();
        
        return res.status(201).json({
            status: true,
            message: 'Payment added successfully',
            data: {
                payment: createdPayment,
                invoice: {
                    _id: invoice._id,
                    paidAmount: invoice.paidAmount,
                    paymentStatus: invoice.paymentStatus
                }
            }
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
            return await exports.addPaymentNoTx(req, res);
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

exports.addPaymentNoTx = async (req, res) => {
    try {
        const { id: invoiceId } = req.params;
        const { amount, method = 'cash', referenceNumber, note, date } = req.body;

        if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
            return res.status(400).json({ status: false, message: 'Invalid invoice ID', data: null });
        }

        const invoice = await PurchaseInvoice.findOne({
            _id: invoiceId,
            customerId: req.customerId
        });

        if (!invoice) {
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }

        if (invoice.status === 'cancelled') {
            return res.status(400).json({ status: false, message: 'Cannot add payment to cancelled invoice', data: null });
        }

        const remainingDebt = Number(invoice.grandTotal) - Number(invoice.paidAmount);

        if (Number(amount) > remainingDebt) {
            return res.status(400).json({
                status: false,
                message: 'المبلغ المدفوع أكبر من المتبقي',
                data: null
            });
        }

        const createdPayment = await PurchaseInvoicePayment.create({
            customerId: req.customerId,
            invoiceId,
            supplierId: invoice.supplierId,
            amount: Number(amount),
            method,
            referenceNumber: referenceNumber || null,
            note: note || null,
            date: date ? new Date(date) : new Date(),
            createdBy: req.user._id,
            status: 'active'
        });

        invoice.paidAmount = Number(invoice.paidAmount) + Number(amount);
        invoice.paymentStatus = computePaymentStatus(invoice.grandTotal, invoice.paidAmount);
        await invoice.save();

        await Supplier.updateOne(
            { _id: invoice.supplierId, customerId: req.customerId },
            { $inc: { balance: -Number(amount) } }
        );

        return res.status(201).json({
            status: true,
            message: 'Payment added successfully',
            data: {
                payment: createdPayment,
                invoice: {
                    _id: invoice._id,
                    paidAmount: invoice.paidAmount,
                    paymentStatus: invoice.paymentStatus
                }
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.listPayments = async (req, res) => {
    try {
        const { id: invoiceId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
            return res.status(400).json({ status: false, message: 'Invalid invoice ID', data: null });
        }

        // Verify invoice belongs to this tenant
        const invoice = await PurchaseInvoice.findOne({
            _id: invoiceId,
            customerId: req.customerId
        }).lean();

        if (!invoice) {
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }

        const payments = await PurchaseInvoicePayment.find({
            customerId: req.customerId,
            invoiceId,
            status: 'active'
        })
            .populate('createdBy', 'name email')
            .populate('voidedBy', 'name email')
            .sort({ date: -1 })
            .lean();

        return res.status(200).json({
            status: true,
            message: 'Payments retrieved successfully',
            data: payments
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.voidPayment = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();

        const { id: invoiceId, paymentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Invalid invoice ID', data: null });
        }

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Invalid payment ID', data: null });
        }

        // Fetch invoice with tenant isolation
        const invoice = await PurchaseInvoice.findOne({
            _id: invoiceId,
            customerId: req.customerId
        }).session(session);

        if (!invoice) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }

        // Check if invoice is cancelled
        if (invoice.status === 'cancelled') {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Cannot void payment on cancelled invoice', data: null });
        }

        // Fetch payment with tenant and invoice isolation
        const payment = await PurchaseInvoicePayment.findOne({
            _id: paymentId,
            customerId: req.customerId,
            invoiceId
        }).session(session);

        if (!payment) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'Payment not found', data: null });
        }

        // Check if payment is already voided
        if (payment.status === 'voided') {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'Payment is already voided', data: null });
        }

        // Reverse the payment effects
        const paymentAmount = Number(payment.amount);

        // Update invoice: decrement paid amount and recalculate status
        invoice.paidAmount = Number(invoice.paidAmount) - paymentAmount;
        invoice.paymentStatus = computePaymentStatus(invoice.grandTotal, invoice.paidAmount);
        await invoice.save({ session });

        // Update supplier balance: restore the debt
        await Supplier.updateOne(
            { _id: invoice.supplierId, customerId: req.customerId },
            { $inc: { balance: paymentAmount } },
            { session }
        );

        // Update payment: mark as voided
        payment.status = 'voided';
        payment.voidedAt = new Date();
        payment.voidedBy = req.user._id;
        await payment.save({ session });

        await session.commitTransaction();

        return res.status(200).json({
            status: true,
            message: 'Payment voided successfully',
            data: {
                payment,
                invoice: {
                    _id: invoice._id,
                    paidAmount: invoice.paidAmount,
                    paymentStatus: invoice.paymentStatus
                }
            }
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
            return await exports.voidPaymentNoTx(req, res);
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

exports.voidPaymentNoTx = async (req, res) => {
    try {
        const { id: invoiceId, paymentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
            return res.status(400).json({ status: false, message: 'Invalid invoice ID', data: null });
        }

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ status: false, message: 'Invalid payment ID', data: null });
        }

        const invoice = await PurchaseInvoice.findOne({
            _id: invoiceId,
            customerId: req.customerId
        });

        if (!invoice) {
            return res.status(404).json({ status: false, message: 'Purchase invoice not found', data: null });
        }

        if (invoice.status === 'cancelled') {
            return res.status(400).json({ status: false, message: 'Cannot void payment on cancelled invoice', data: null });
        }

        const payment = await PurchaseInvoicePayment.findOne({
            _id: paymentId,
            customerId: req.customerId,
            invoiceId
        });

        if (!payment) {
            return res.status(404).json({ status: false, message: 'Payment not found', data: null });
        }

        if (payment.status === 'voided') {
            return res.status(400).json({ status: false, message: 'Payment is already voided', data: null });
        }

        const paymentAmount = Number(payment.amount);

        invoice.paidAmount = Number(invoice.paidAmount) - paymentAmount;
        invoice.paymentStatus = computePaymentStatus(invoice.grandTotal, invoice.paidAmount);
        await invoice.save();

        await Supplier.updateOne(
            { _id: invoice.supplierId, customerId: req.customerId },
            { $inc: { balance: paymentAmount } }
        );

        payment.status = 'voided';
        payment.voidedAt = new Date();
        payment.voidedBy = req.user._id;
        await payment.save();

        return res.status(200).json({
            status: true,
            message: 'Payment voided successfully',
            data: {
                payment,
                invoice: {
                    _id: invoice._id,
                    paidAmount: invoice.paidAmount,
                    paymentStatus: invoice.paymentStatus
                }
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};
