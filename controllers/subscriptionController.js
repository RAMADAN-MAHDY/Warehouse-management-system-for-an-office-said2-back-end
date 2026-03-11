const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
const Plan = require('../models/Plan');
const User = require('../models/User');
const { createNotification } = require('./notificationController');
const { submitPaymentSchema } = require('../validations/subscriptionValidation');

// Removed hardcoded PLANS object to use dynamic Plan model from DB

const getPlanConfig = async (planId) => {
    // جلب الخطة من قاعدة البيانات
    return await Plan.findOne({ id: planId });
};

exports.getSubscriptionStatus = async (req, res) => {
    try {
        let subscription = await Subscription.findOne({ customerId: req.customerId });
        
        // إذا لم يوجد اشتراك (لمستخدم قديم مثلاً)، قم بإنشاء واحد تجريبي تلقائياً
        if (!subscription) {
            const freePlan = await getPlanConfig('free');
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            
            subscription = await Subscription.create({
                customerId: req.customerId,
                planType: 'free',
                status: 'active',
                startDate: new Date(),
                endDate,
                limits: freePlan ? freePlan.limits : { maxItems: 200, maxSales: 200, maxExpenses: 200 }
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
        // ===== التحقق من صحة البيانات باستخدام Joi =====
        const { error, value } = submitPaymentSchema.validate(req.body, { abortEarly: true });
        if (error) {
            return res.status(400).json({ status: false, message: error.details[0].message });
        }

        const { amount, referenceNumber, planRequested } = value;

        // التحقق من الخطة في قاعدة البيانات
        const planConfig = await getPlanConfig(planRequested);
        if (!planConfig) {
            return res.status(400).json({ status: false, message: 'خطة غير صالحة' });
        }

        if (amount < planConfig.price) {
            return res.status(400).json({ status: false, message: 'المبلغ غير كافٍ لهذه الخطة' });
        }

        // التحقق من عدم وجود طلب معلق مسبقاً لنفس المستخدم
        const existingPending = await Transaction.findOne({
            customerId: req.customerId,
            status: 'pending'
        });
        if (existingPending) {
            return res.status(400).json({ status: false, message: 'لديك طلب اشتراك قيد المراجعة بالفعل، يرجى الانتظار حتى تتم معالجته.' });
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

// وظيفة للحصول على الخطط العامة المتاحة للاشتراك
exports.getPublicPlans = async (req, res) => {
    try {
        const plans = await Plan.find({ isPublic: true }).sort({ price: 1 });
        res.json({ status: true, data: plans });
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
