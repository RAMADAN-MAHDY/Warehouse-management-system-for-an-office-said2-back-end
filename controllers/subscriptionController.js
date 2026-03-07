const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
const Plan = require('../models/Plan');
const User = require('../models/User');
const { createNotification } = require('./notificationController');

const PLANS = {
    free: {
        name: 'تجريبية',
        price: 0,
        limits: { maxItems: 200, maxSales: 200, maxExpenses: 200 }
    },
    basic: {
        name: 'أساسية',
        price: 180,
        limits: { maxItems: 200, maxSales: 200, maxExpenses: 200 }
    },
    professional: {
        name: 'احترافية',
        price: 480,
        limits: { maxItems: 2000, maxSales: 2000, maxExpenses: 2000 }
    }
};

const getPlanConfig = async (planId) => {
    // حاول جلب الخطة من قاعدة البيانات أولاً
    const dbPlan = await Plan.findOne({ id: planId });
    if (dbPlan) return dbPlan;
    
    // العودة للقيم الثابتة كخيار احتياطي
    return PLANS[planId];
};

exports.getSubscriptionStatus = async (req, res) => {
    try {
        let subscription = await Subscription.findOne({ customerId: req.customerId });
        
        // إذا لم يوجد اشتراك (لمستخدم قديم مثلاً)، قم بإنشاء واحد تجريبي تلقائياً
        if (!subscription) {
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            subscription = await Subscription.create({
                customerId: req.customerId,
                planType: 'free',
                status: 'active',
                startDate: new Date(),
                endDate,
                limits: PLANS.professional.limits
            });
        }

        const cid = req.customerId;
        const [itemsCount, salesCount, purchasesCount, expensesCount] = await Promise.all([
            Item.countDocuments({ customerId: cid }),
            SaleInvoice.countDocuments({ customerId: cid }),
            Purchase.countDocuments({ customerId: cid }),
            Expense.countDocuments({ customerId: cid })
        ]);

        res.json({
            status: true,
            data: {
                plan: subscription.planType,
                status: subscription.status,
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                limits: subscription.limits,
                usage: {
                    items: itemsCount,
                    sales: salesCount + purchasesCount,
                    expenses: expensesCount
                },
                daysLeft: Math.ceil((new Date(subscription.endDate) - new Date()) / (1000 * 60 * 60 * 24))
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.submitPayment = async (req, res) => {
    try {
        const { amount, referenceNumber, planRequested } = req.body;
        const planConfig = await getPlanConfig(planRequested);

        if (!planConfig) {
            return res.status(400).json({ status: false, message: 'خطة غير صالحة' });
        }

        if (amount < planConfig.price) {
            return res.status(400).json({ status: false, message: 'المبلغ غير كافٍ لهذه الخطة' });
        }

        const transaction = await Transaction.create({
            customerId: req.customerId,
            amount,
            referenceNumber,
            planRequested,
            status: 'pending'
        });

        res.status(201).json({
            status: true,
            message: 'تم استلام طلب الدفع بنجاح، سيتم تفعيل الاشتراك بعد المراجعة (عادة خلال أقل من ساعة).',
            data: transaction
        });

        // إرسال تنبيه للمستخدم
        await createNotification(
            req.customerId,
            'تم استلام طلب اشتراكك بنجاح وجاري المراجعة الآن.',
            'subscription_request',
            { transactionId: transaction._id }
        );

        // إرسال تنبيه لكل السوبر أدمن
        const superAdmins = await User.find({ role: 'superadmin' });
        const user = await User.findOne({ customerId: req.customerId });
        
        for (const admin of superAdmins) {
            await createNotification(
                admin.customerId,
                `طلب اشتراك جديد من ${user?.username || 'عميل'} بنوع ${planRequested}`,
                'subscription_request',
                { transactionId: transaction._id, customerId: req.customerId }
            );
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// وظيفة للمسؤول لتفعيل الاشتراك يدوياً (محاكاة)
exports.activateSubscription = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const transaction = await Transaction.findById(transactionId);

        if (!transaction) return res.status(404).json({ status: false, message: 'المعاملة غير موجودة' });
        if (transaction.status !== 'pending') return res.status(400).json({ status: false, message: 'المعاملة تمت معالجتها بالفعل' });

        const planConfig = await getPlanConfig(transaction.planRequested);
        if (!planConfig) return res.status(400).json({ status: false, message: 'تكوين الخطة غير موجود' });

        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);

        await Subscription.findOneAndUpdate(
            { customerId: transaction.customerId },
            {
                planType: transaction.planRequested,
                status: 'active',
                endDate,
                limits: planConfig.limits
            },
            { upsert: true }
        );

        transaction.status = 'completed';
        transaction.processedAt = new Date();
        await transaction.save();

        res.json({ status: true, message: 'تم تفعيل الاشتراك بنجاح' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
