const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipientId: {
        type: String, // customerId
        required: true,
        index: true
    },
    senderName: {
        type: String,
        default: 'النظام'
    },
    message: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['subscription_request', 'subscription_approval', 'subscription_rejection', 'system_alert'],
        default: 'system_alert'
    },
    data: {
        type: Object,
        default: {}
    },
    isRead: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
