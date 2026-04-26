const Subscription = require('../models/Subscription');
const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');

/**
 * Middleware للتحقق من حالة الاشتراك قبل تنفيذ العمليات الحساسة
 */
const checkSubscription = async (req, res, next) => {
    // تخطي التحقق للمسؤولين (superadmin)
    if (req.user && req.user.role === 'superadmin') {
        return next();
    }

    try {
        const subscription = await Subscription.findOne({ customerId: req.customerId });

        if (!subscription) {
            return res.status(402).json({
                status: false,
                message: 'لا يوجد اشتراك نشط لهذا الحساب. يرجى الاشتراك للمتابعة.',
                type: 'SUBSCRIPTION_REQUIRED'
            });
        }

        // التحقق من تاريخ انتهاء الصلاحية
        const now = new Date();
        if (subscription.endDate < now) {
            if (subscription.status !== 'expired') {
                subscription.status = 'expired';
                await subscription.save();
            }
            return res.status(402).json({
                status: false,
                message: 'انتهت صلاحية اشتراكك. يرجى تجديد الاشتراك للمتابعة.',
                type: 'SUBSCRIPTION_EXPIRED'
            });
        }

        if (subscription.status !== 'active') {
            return res.status(403).json({
                status: false,
                message: 'تم إيقاف حسابك مؤقتاً. يرجى التواصل مع الدعم الفني.',
                type: 'ACCOUNT_RESTRICTED'
            });
        }

        // إذا كان كل شيء تمام، انتقل للمرحلة التالية
        req.subscription = subscription;
        next();
    } catch (error) {
        console.error('Subscription Middleware Error:', error);
        next(); // السماح بالمرور في حالة حدوث خطأ تقني غير متوقع لتجنب تعطل النظام
    }
};

/**
 * Middleware للتحقق من حدود الاستهلاك قبل العمليات (مثل إضافة منتج أو فاتورة)
 */
const checkLimit = (resource) => {
    return async (req, res, next) => {
        // تخطي التحقق للمسؤولين
        if (req.user && req.user.role === 'superadmin') {
            return next();
        }

        try {
            // ملاحظة: req.subscription يتم تعيينه في checkSubscription
            let subscription = req.subscription;
            
            if (!subscription) {
                subscription = await Subscription.findOne({ customerId: req.customerId });
            }

            if (!subscription || subscription.status !== 'active') {
                return res.status(402).json({
                    status: false,
                    message: 'يجب أن يكون لديك اشتراك نشط.',
                    type: 'SUBSCRIPTION_REQUIRED'
                });
            }

            // خريطة الموارد للحدود
            const limitsMap = {
                items: { limit: 'maxItems' },
                sales: { limit: 'maxSales' },
                expenses: { limit: 'maxExpenses' }
            };

            const config = limitsMap[resource];
            if (!config) return next();

            const limit = subscription.limits?.[config.limit] || 0;
            
            // حساب الاستهلاك الفعلي حالياً لضمان الدقة
            let currentUsage = 0;
            const cid = req.customerId;
            
            if (resource === 'items') {
                currentUsage = await Item.countDocuments({ customerId: cid });
            } else if (resource === 'sales') {
                const salesCount = await SaleInvoice.countDocuments({ customerId: cid });
                const purchasesCount = await Purchase.countDocuments({ customerId: cid });
                currentUsage = salesCount + purchasesCount;
            } else if (resource === 'expenses') {
                currentUsage = await Expense.countDocuments({ customerId: cid });
            }

            if (currentUsage >= limit) {
                const resourceNameAr = resource === 'items' ? 'منتج' : resource === 'sales' ? 'عملية (بيع/شراء)' : 'مصروف';
                return res.status(400).json({
                    status: false,
                    message: `لقد وصلت للحد الأقصى المسموح به في خطتك (${limit} ${resourceNameAr}). يرجى ترقية الاشتراك للمتابعة.`,
                    type: 'LIMIT_REACHED'
                });
            }

            next();
        } catch (error) {
            console.error('Check Limit Middleware Error:', error);
            next();
        }
    };
};

module.exports = {
    checkSubscription,
    checkLimit
};
