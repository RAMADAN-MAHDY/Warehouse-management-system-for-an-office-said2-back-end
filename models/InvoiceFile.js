const mongoose = require('mongoose');

const invoiceFileSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        index: true,
    },
    buffer: {
        type: Buffer,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('InvoiceFile', invoiceFileSchema);