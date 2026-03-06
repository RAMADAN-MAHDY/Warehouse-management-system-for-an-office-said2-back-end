const Subscription = require('../models/Subscription');
const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');

const checkSubscription = async (req, res, next) => {
    try {
        const subscription = await Subscription.findOne({ customerId: req.customerId });

        if (!subscription) {
            return res.status(403).json({
                status: false,
                message: 'لم يتم العثور على اشتراك نشط. يرجى الاتصال بالدعم.'
            });
        }

        // التحقق من تاريخ انتهاء الاشتراك
        if (new Date() > subscription.endDate) {
            if (subscription.status !== 'expired') {
                subscription.status = 'expired';
                await subscription.save();
            }
            return res.status(403).json({
                status: false,
                message: 'انتهت مدة اشتراكك. يرجى التجديد للمتابعة.'
            });
        }

        if (subscription.status !== 'active') {
            return res.status(403).json({
                status: false,
                message: 'حسابك غير نشط حالياً.'
            });
        }

        // إلحاق بيانات الاشتراك بالطلب لاستخدامها لاحقاً
        req.subscription = subscription;
        next();
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

const checkLimit = (type) => {
    return async (req, res, next) => {
        try {
            const { subscription } = req;
            const cid = req.customerId;
            let currentCount = 0;
            let maxLimit = 0;
            let label = '';

            if (type === 'items') {
                currentCount = await Item.countDocuments({ customerId: cid });
                maxLimit = subscription.limits.maxItems;
                label = 'المنتجات';
            } else if (type === 'sales') {
                // عمليات البيع والشراء مجتمعة حسب المتطلبات (200 عملية بيع/شراء)
                const salesCount = await SaleInvoice.countDocuments({ customerId: cid });
                const purchasesCount = await Purchase.countDocuments({ customerId: cid });
                currentCount = salesCount + purchasesCount;
                maxLimit = subscription.limits.maxSales; // نفترض أن maxSales هو حد العمليات الكلي
                label = 'عمليات البيع والشراء';
            } else if (type === 'expenses') {
                currentCount = await Expense.countDocuments({ customerId: cid });
                maxLimit = subscription.limits.maxExpenses;
                label = 'المصاريف';
            }

            if (currentCount >= maxLimit) {
                return res.status(403).json({
                    status: false,
                    message: `لقد وصلت للحد الأقصى المسموح به لـ ${label} في خطتك الحالية (${maxLimit}). يرجى الترقية لزيادة الحد.`
                });
            }
            next();
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
    };
};

module.exports = { checkSubscription, checkLimit };
