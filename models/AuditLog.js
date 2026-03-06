const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    customerId: {
        type: String,
        index: true,
        required: true
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { 
        type: String, 
        required: true 
        // Removing enum for more flexibility as the system grows
    },
    details: { type: Object }, // To store action-specific details
    changes: { type: Object }, // To store old/new values
    ipAddress: { type: String },
    performedBy: { type: String }, // Username of the admin or user
    at: { type: Date, default: Date.now }
}, { timestamps: true });

schema.index({ customerId: 1, at: -1 });

module.exports = mongoose.model('AuditLog', schema);
