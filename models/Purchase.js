const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        index: true,
    },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    type: { type: String, enum: ['purchase', 'adjustment'], default: 'purchase' },
    reason: { type: String, default: '' },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', index: true },
    modelNumber: { type: String },
    name: { type: String },
    quantity: { type: Number, min: 0 },
    price: { type: Number, min: 0 },
    supplier: { type: String }
}, { timestamps: true });

purchaseSchema.index({ customerId: 1, date: -1 });

module.exports = mongoose.model('Purchase', purchaseSchema);
