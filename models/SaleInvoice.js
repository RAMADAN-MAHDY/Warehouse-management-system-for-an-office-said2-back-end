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
    totalCost: { type: Number, required: true, min: 0, default: 0 }, // إجمالي تكلفة الفاتورة (COGS) الثابت عند الإنشاء
    total: { type: Number, required: true },
    paidAmount: { type: Number, default: 0, min: 0 },
    paymentStatus: {
        type: String,
        enum: ['paid', 'partial', 'unpaid'],
        default: 'unpaid'
    },
    createdAt: { type: Date, default: Date.now },
    sellerName: { type: String, required: false },
    clientName: { type: String, required: false, trim: true },
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: false,
        index: true,
    },
    representativeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Representative',
        required: false,
        index: true,
    },
}, { timestamps: true });

saleInvoiceSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('SaleInvoice', saleInvoiceSchema);
