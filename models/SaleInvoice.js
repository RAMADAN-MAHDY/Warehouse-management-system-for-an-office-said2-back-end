const mongoose = require('mongoose');

const saleInvoiceSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        index: true,
    },
    modelNumber: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, required: true, min: 0, default: 0 }, // إضافة سعر التكلفة
    total: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    sellerName: { type: String, required: false },
});

saleInvoiceSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('SaleInvoice', saleInvoiceSchema);
