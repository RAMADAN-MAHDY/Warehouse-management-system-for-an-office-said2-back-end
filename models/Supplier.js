const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
    {
        customerId: {
            type: String,
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },
        phone: { type: String, trim: true, maxlength: 50 },
        email: { type: String, trim: true, lowercase: true, maxlength: 200 },
        address: { type: String, trim: true, maxlength: 500 },
        balance: { type: Number, default: 0 },
    },
    { timestamps: true }
);

supplierSchema.index({ customerId: 1, name: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);
