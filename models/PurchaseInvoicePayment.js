const mongoose = require('mongoose');

const purchaseInvoicePaymentSchema = new mongoose.Schema(
    {
        customerId: {
            type: String,
            required: true,
            index: true,
        },
        invoiceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PurchaseInvoice',
            required: true,
            index: true,
        },
        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Supplier',
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 0.01,
        },
        method: {
            type: String,
            enum: ['cash', 'bank_transfer', 'cheque', 'other'],
            default: 'cash',
        },
        referenceNumber: {
            type: String,
            trim: true,
            maxlength: 100,
            default: null,
        },
        note: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null,
        },
        date: {
            type: Date,
            default: Date.now,
            index: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        status: {
            type: String,
            enum: ['active', 'voided'],
            default: 'active',
            index: true,
        },
        voidedAt: {
            type: Date,
            default: null,
        },
        voidedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

purchaseInvoicePaymentSchema.index({ customerId: 1, invoiceId: 1 });
purchaseInvoicePaymentSchema.index({ customerId: 1, supplierId: 1 });
purchaseInvoicePaymentSchema.index({ customerId: 1, date: -1 });

module.exports = mongoose.model('PurchaseInvoicePayment', purchaseInvoicePaymentSchema);
