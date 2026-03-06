const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        default: 'EGP'
    },
    durationDays: {
        type: Number,
        default: 30
    },
    limits: {
        maxItems: { type: Number, required: true },
        maxSales: { type: Number, required: true },
        maxExpenses: { type: Number, required: true }
    },
    features: [String],
    isPublic: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);
