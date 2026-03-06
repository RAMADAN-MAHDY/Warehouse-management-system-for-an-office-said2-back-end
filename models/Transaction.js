const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        index: true,
    },
    amount: {
        type: Number,
        required: true
    },
    paymentMethod: {
        type: String,
        default: 'vodafone_cash'
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    referenceNumber: {
        type: String, // رقم العملية من فودافون كاش
        required: true
    },
    planRequested: {
        type: String,
        enum: ['basic', 'professional'],
        required: true
    },
    notes: String,
    processedBy: String, // ID المسؤول الذي راجع الدفعة
    processedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
