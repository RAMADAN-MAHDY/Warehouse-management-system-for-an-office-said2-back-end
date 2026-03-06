const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    planType: {
        type: String,
        enum: ['free', 'basic', 'professional'],
        default: 'free'
    },
    status: {
        type: String,
        enum: ['active', 'expired', 'cancelled'],
        default: 'active'
    },
    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: {
        type: Date,
        required: true
    },
    // الحدود القصوى بناءً على الخطة (الافتراضي يطابق الخطة المجانية)
    limits: {
        maxItems: { type: Number, default: 200 },
        maxSales: { type: Number, default: 200 },
        maxExpenses: { type: Number, default: 200 }
    },
    // الاستهلاك الحالي (يتم تحديثه مع كل عملية)
    usage: {
        items: { type: Number, default: 0 },
        sales: { type: Number, default: 0 },
        expenses: { type: Number, default: 0 }
    },
    lastNotifiedAt: {
        type: Date
    }
}, { timestamps: true });

// تحديث حالة الاشتراك تلقائياً عند الاستعلام
// تحديث حالة الاشتراك تلقائياً عند الاستعلام
// تم تعطيله لصالح التحقق في Middleware لضمان ظهور رسائل واضحة للعميل
/*
subscriptionSchema.pre('find', function() {
    this.where({ endDate: { $gte: new Date() } });
});
*/

module.exports = mongoose.model('Subscription', subscriptionSchema);
