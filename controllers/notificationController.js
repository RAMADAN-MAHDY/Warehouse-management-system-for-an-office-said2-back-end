const Notification = require('../models/Notification');

exports.getNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ recipientId: req.customerId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        
        const unreadCount = await Notification.countDocuments({ 
            recipientId: req.customerId, 
            isRead: false 
        });

        res.json({ 
            status: true, 
            data: {
                notifications,
                unreadCount
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findOneAndUpdate(
            { _id: id, recipientId: req.customerId },
            { isRead: true },
            { new: true }
        ).lean();

        if (!notification) {
            return res.status(404).json({ status: false, message: 'التنبيه غير موجود' });
        }

        res.json({ status: true, message: 'تم التحديد كمقروء' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { recipientId: req.customerId, isRead: false },
            { isRead: true }
        );
        res.json({ status: true, message: 'تم تحديد الكل كمقروء' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findOneAndDelete({
            _id: id,
            recipientId: req.customerId
        });
        if (!notification) {
            return res.status(404).json({ status: false, message: 'التنبيه غير موجود' });
        }
        res.json({ status: true, message: 'تم حذف التنبيه' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// Helper function to create notification (not an exported route)
exports.createNotification = async (recipientId, message, type, data = {}, senderName = 'النظام') => {
    try {
        await Notification.create({
            recipientId,
            message,
            type,
            data,
            senderName
        });
    } catch (error) {
        console.error('Error creating notification:', error);
    }
};

exports.checkAndNotifyLowStock = async (item, customerId) => {
    try {
        const minQty = item.minQuantity !== undefined ? item.minQuantity : 5;
        if (item.quantity < minQty) {
            // Check if there is already an unread alert for this item to avoid spamming
            const exists = await Notification.findOne({
                recipientId: customerId,
                isRead: false,
                type: 'system_alert',
                'data.itemId': item._id.toString()
            });

            if (!exists) {
                await exports.createNotification(
                    customerId,
                    `تنبيه مخزون: كمية المنتج "${item.name}" (موديل: ${item.modelNumber}) منخفضة جداً (${item.quantity} قطع متبقية). الحد الأدنى هو ${minQty}.`,
                    'system_alert',
                    { itemId: item._id, quantity: item.quantity, minQuantity: minQty }
                );
            }
        }
    } catch (err) {
        console.error('Error checking low stock:', err);
    }
};
