const mongoose = require('mongoose');

const invoiceFileSchema = new mongoose.Schema({
    
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