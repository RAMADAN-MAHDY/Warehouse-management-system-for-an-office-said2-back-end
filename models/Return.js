const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        index: true,
    },
    saleInvoiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SaleInvoice',
        required: true,
        index: true,
    },
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Item',
        required: true,
    },
    modelNumber: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true },
    reason: { type: String, trim: true },
    sellerName: { type: String },
    date: { type: Date, default: Date.now },
}, { timestamps: true });

returnSchema.index({ customerId: 1, date: -1 });

module.exports = mongoose.model('Return', returnSchema);
