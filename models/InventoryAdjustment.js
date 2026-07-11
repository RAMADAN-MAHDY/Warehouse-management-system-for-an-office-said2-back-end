const mongoose = require('mongoose');

const inventoryAdjustmentSchema = new mongoose.Schema(
    {
        customerId: {
            type: String,
            required: true,
            index: true,
        },
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            required: true,
            index: true,
        },
        qtyDelta: { type: Number, required: true },
        unitCost: { type: Number, min: 0 },
        reason: { type: String, trim: true, maxlength: 500, default: '' },
        date: { type: Date, default: Date.now, index: true },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

inventoryAdjustmentSchema.index({ customerId: 1, itemId: 1, date: -1 });

module.exports = mongoose.model('InventoryAdjustment', inventoryAdjustmentSchema);
