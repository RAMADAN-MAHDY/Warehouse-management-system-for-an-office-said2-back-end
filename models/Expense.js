const mongoose = require('mongoose');
// المصروفات
const expenseSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        index: true,
    },
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    paymentStatus: {
        type: String,
        enum: ['paid', 'partial', 'unpaid'],
        default: 'unpaid'
    },
    date: { type: Date, default: Date.now },
});

expenseSchema.index({ customerId: 1, date: -1 });

module.exports = mongoose.model('Expense', expenseSchema);