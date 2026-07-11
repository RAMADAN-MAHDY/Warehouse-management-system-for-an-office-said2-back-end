const mongoose = require('mongoose');

const stockMovementSchema = new mongoose.Schema(
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
        qty: { type: Number, required: true, min: 0.000001 },
        direction: { type: String, enum: ['IN', 'OUT'], required: true, index: true },
        reason: {
            type: String,
            enum: ['PURCHASE', 'SALE', 'ADJUSTMENT', 'RETURN', 'PURCHASE_CANCEL', 'OPENING_BALANCE'],
            required: true,
            index: true,
        },
        referenceType: {
            type: String,
            enum: ['PURCHASE_INVOICE', 'SALE_INVOICE', 'INVENTORY_ADJUSTMENT', 'RETURN'],
            required: true,
            index: true,
        },
        referenceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        unitCost: { type: Number, min: 0 },
        date: { type: Date, default: Date.now, index: true },
    },
    { timestamps: true }
);

stockMovementSchema.index({ customerId: 1, itemId: 1, date: -1 });
stockMovementSchema.index({ customerId: 1, referenceType: 1, referenceId: 1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
