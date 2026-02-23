const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    customerId: {
        type: String,
        index: true,
        required: true
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, enum: ['create', 'update', 'delete'] },
    purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase' },
    changes: { type: Object },
    at: { type: Date, default: Date.now }
}, { timestamps: true });

schema.index({ customerId: 1, at: -1 });

module.exports = mongoose.model('AuditLog', schema);
