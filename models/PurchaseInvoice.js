const mongoose = require('mongoose');

const purchaseInvoiceItemSchema = new mongoose.Schema(
    {
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            required: true,
        },
        qty: { type: Number, required: true, min: 0.000001 },
        unitCost: { type: Number, required: true, min: 0 },
        lineTotal: { type: Number, required: true, min: 0 },
    },
    { _id: false }
);

const purchaseInvoiceSchema = new mongoose.Schema(
    {
        customerId: {
            type: String,
            required: true,
            index: true,
        },
        invoiceNumber: { type: String, required: true, trim: true, maxlength: 100 },
        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Supplier',
            required: true,
            index: true,
        },
        date: { type: Date, default: Date.now, index: true },
        status: {
            type: String,
            enum: ['posted', 'cancelled'],
            default: 'posted',
            index: true,
        },
        items: { type: [purchaseInvoiceItemSchema], required: true },
        subTotal: { type: Number, required: true, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        grandTotal: { type: Number, required: true, min: 0 },
        paidAmount: { type: Number, default: 0, min: 0 },
        cancelledAt: { type: Date },
        cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

purchaseInvoiceSchema.index({ customerId: 1, invoiceNumber: 1 }, { unique: true });
purchaseInvoiceSchema.index({ customerId: 1, date: -1 });

module.exports = mongoose.model('PurchaseInvoice', purchaseInvoiceSchema);
