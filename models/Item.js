const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        index: true,
    },
    modelNumber: {
        type: String,
        required: true,
        trim: true,
    },
    customer: {
        type: String,
        required: false,
        trim: true,
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    quantity: {
        type: Number,
        required: true,
        min: 0,
    },
    price: {
        type: Number,
        required: true,
        min: 0,
    },
    costPrice: { // إضافة حقل سعر التكلفة
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// فهرس مركّب لأداء أفضل في البحث ضمن عميل محدد
itemSchema.index({ customerId: 1, modelNumber: 1 });
itemSchema.index({ customerId: 1, name: 1 });

module.exports = mongoose.model('Item', itemSchema);
