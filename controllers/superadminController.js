const User = require('../models/User');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const AuditLog = require('../models/AuditLog');
const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');

const exportExcel = require('../utils/exportExcel');
const { createNotification } = require('./notificationController');

// --- تصدير البيانات ---
exports.exportUsersExcel = async (req, res) => {
    try {
        const users = await User.find({ role: { $ne: 'superadmin' } }).sort({ createdAt: -1 });
        const usersWithSubscriptions = await Promise.all(users.map(async (user) => {
            const sub = await Subscription.findOne({ customerId: user.customerId });
            return {
                'كود العميل': user.customerId,
                'اسم المستخدم': user.username,
                'اسم الشركة': user.companyName,
                'البريد الإلكتروني': user.email || 'غير متوفر',
                'الحالة': user.isBanned ? 'محظور' : 'نشط',
                'نوع الخطة': sub ? sub.planType : 'لا يوجد',
                'حالة الاشتراك': sub ? sub.status : 'غير مسجل',
                'تاريخ انتهاء الاشتراك': sub ? new Date(sub.endDate).toLocaleDateString('ar-EG') : '-',
                'تاريخ التسجيل': new Date(user.createdAt).toLocaleDateString('ar-EG')
            };
        }));

        const buffer = exportExcel(usersWithSubscriptions, 'المستخدمين');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=users-report.xlsx');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.exportTransactionsExcel = async (req, res) => {
    try {
        const transactions = await Transaction.find().sort({ createdAt: -1 });
        const data = transactions.map(t => ({
            'كود العميل': t.customerId,
            'المبلغ': t.amount,
            'رقم العملية': t.referenceNumber,
            'الخطة المطلوبة': t.planRequested,
            'الحالة': t.status === 'completed' ? 'تم القبول' : t.status === 'failed' ? 'مرفوض' : 'قيد الانتظار',
            'التاريخ': new Date(t.createdAt).toLocaleDateString('ar-EG'),
            'عولج بواسطة': t.processedBy || '-',
            'ملاحظات': t.notes || '-'
        }));

        const buffer = exportExcel(data, 'المدفوعات');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=transactions-report.xlsx');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// --- إحصائيات النظام العامة ---
exports.getSystemStats = async (req, res) => {
    try {
        const [
            totalUsers,
            activeSubscriptions,
            totalRevenue,
            totalItems,
            pendingPaymentsCount,
            latestPendingPayments
        ] = await Promise.all([
            User.countDocuments({ role: { $ne: 'superadmin' } }),
            Subscription.countDocuments({ status: 'active' }),
            Transaction.aggregate([
                { $match: { status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Item.countDocuments(),
            Transaction.countDocuments({ status: 'pending' }),
            Transaction.aggregate([
                { $match: { status: 'pending' } },
                { $sort: { createdAt: -1 } },
                { $limit: 3 },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'customerId',
                        foreignField: 'customerId',
                        as: 'user'
                    }
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 1,
                        customerId: 1,
                        amount: 1,
                        planRequested: 1,
                        createdAt: 1,
                        'user.username': 1,
                        'user.email': 1
                    }
                }
            ])
        ]);

        res.json({
            status: true,
            data: {
                users: totalUsers,
                activeSubscriptions,
                revenue: totalRevenue[0]?.total || 0,
                items: totalItems,
                pendingPayments: pendingPaymentsCount,
                latestPendingPayments: latestPendingPayments
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

const InvoiceFile = require('../models/InvoiceFile');
const mongoose = require('mongoose');

// --- إحصائيات النظام العامة ---
// ... (keep existing getSystemStats)

// --- إدارة المستخدمين ---
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find({ role: { $ne: 'superadmin' } }).sort({ createdAt: -1 });
        
        // جلب تفاصيل الاشتراك لكل مستخدم
        const usersWithSubscriptions = await Promise.all(users.map(async (user) => {
            const subscription = await Subscription.findOne({ customerId: user.customerId });
            return {
                ...user.toObject(),
                subscription: subscription || null
            };
        }));

        res.json({ status: true, data: usersWithSubscriptions });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.updateUserStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const { isBanned, role, reason } = req.body; // إضافة reason لسجل التدقيق

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ status: false, message: 'المستخدم غير موجود' });
        if (user.role === 'superadmin') return res.status(403).json({ status: false, message: 'لا يمكن تعديل بيانات سوبر أدمن آخر' });

        const oldStatus = user.isBanned;
        if (isBanned !== undefined) user.isBanned = isBanned;
        if (role) user.role = role;

        await user.save();

        // تسجيل العملية في AuditLog
        await AuditLog.create({
            action: isBanned !== oldStatus ? (isBanned ? 'BAN_USER' : 'UNBAN_USER') : 'UPDATE_USER_ROLE',
            customerId: user.customerId,
            details: { 
                reason: reason || 'تحديث حالة المستخدم من قبل السوبر أدمن',
                performedBy: req.user.username,
                userId: user._id
            },
            ipAddress: req.ip
        });

        res.json({ status: true, message: 'تم تحديث بيانات المستخدم بنجاح', data: user });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.deleteUserPermanently = async (req, res) => {
    try {
        // التأكد من أن الاتصال بقاعدة البيانات جاهز
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ status: false, message: 'قاعدة البيانات غير متصلة حالياً، يرجى المحاولة مرة أخرى' });
        }

        const { userId } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ status: false, message: 'يجب ذكر سبب الحذف النهائي' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ status: false, message: 'المستخدم غير موجود' });
        if (user.role === 'superadmin') return res.status(403).json({ status: false, message: 'لا يمكن حذف حساب سوبر أدمن' });

        const cid = user.customerId;

        // تنفيذ الحذف المتسلسل لجميع البيانات المرتبطة بالكود التعريفي للعميل (customerId)
        // نقوم بتنفيذ العمليات بشكل متتابع لضمان أقصى درجات التوافق مع مختلف إصدارات وإعدادات MongoDB
        await Item.deleteMany({ customerId: cid });
        await SaleInvoice.deleteMany({ customerId: cid });
        await Purchase.deleteMany({ customerId: cid });
        await Expense.deleteMany({ customerId: cid });
        await Subscription.deleteMany({ customerId: cid });
        await Transaction.deleteMany({ customerId: cid });
        await InvoiceFile.deleteMany({ customerId: cid });
        
        // حذف المستخدم نفسه في النهاية
        await User.findByIdAndDelete(userId);

        // تسجيل العملية في سجل التدقيق (AuditLog)
        await AuditLog.create({
            action: 'PERMANENT_DELETE_USER',
            customerId: cid,
            details: { 
                reason, 
                username: user.username,
                companyName: user.companyName,
                performedBy: req.user.username 
            },
            ipAddress: req.ip
        });

        res.json({ status: true, message: 'تم حذف المستخدم وكافة بياناته نهائياً بنجاح' });
    } catch (error) {
        console.error('Error in permanent delete:', error);
        res.status(500).json({ status: false, message: error.message });
    }
};

// --- إدارة خطط الاشتراك ---
// ... (keep existing createPlan, getPlans, updatePlan, deletePlan)

// --- إدارة الاشتراكات والمدفوعات ---
exports.approveTransaction = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { notes = 'تم القبول من قبل الإدارة' } = req.body; // جعل notes اختيارية بقيمة افتراضية

        const transaction = await Transaction.findById(transactionId);
        if (!transaction) return res.status(404).json({ status: false, message: 'المعاملة غير موجودة' });
        if (transaction.status !== 'pending') return res.status(400).json({ status: false, message: 'المعاملة تمت معالجتها بالفعل' });

        // تفعيل الاشتراك (مناداة الوظيفة الموجودة أو إعادة كتابتها هنا لضمان التدقيق)
        const Plan = require('../models/Plan');
        const dbPlan = await Plan.findOne({ id: transaction.planRequested });
        
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);

        await Subscription.findOneAndUpdate(
            { customerId: transaction.customerId },
            {
                planType: transaction.planRequested,
                status: 'active',
                endDate,
                limits: dbPlan ? dbPlan.limits : { maxItems: 200, maxSales: 200, maxExpenses: 200 }
            },
            { upsert: true }
        );

        transaction.status = 'completed';
        transaction.processedBy = req.user.username;
        transaction.processedAt = new Date();
        transaction.notes = notes || 'تم القبول من قبل الإدارة';
        await transaction.save();

        await AuditLog.create({
            action: 'APPROVE_PAYMENT',
            customerId: transaction.customerId,
            details: { transactionId, amount: transaction.amount, plan: transaction.planRequested },
            ipAddress: req.ip
        });

        res.json({ status: true, message: 'تم قبول الدفعة وتفعيل الاشتراك بنجاح' });

        // إرسال تنبيه للمستخدم بالقبول
        await createNotification(
            transaction.customerId,
            `تهانينا! تم قبول طلب اشتراكك وتفعيل خطة ${transaction.planRequested} بنجاح.`,
            'subscription_approval',
            { transactionId: transaction._id, planType: transaction.planRequested }
        );
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.rejectTransaction = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { reason } = req.body;

        if (!reason) return res.status(400).json({ status: false, message: 'يجب ذكر سبب الرفض' });

        const transaction = await Transaction.findById(transactionId);
        if (!transaction) return res.status(404).json({ status: false, message: 'المعاملة غير موجودة' });
        if (transaction.status !== 'pending') return res.status(400).json({ status: false, message: 'المعاملة تمت معالجتها بالفعل' });

        transaction.status = 'failed';
        transaction.processedBy = req.user.username;
        transaction.processedAt = new Date();
        transaction.notes = `مرفوض: ${reason}`;
        await transaction.save();

        await AuditLog.create({
            action: 'REJECT_PAYMENT',
            customerId: transaction.customerId,
            details: { transactionId, reason },
            ipAddress: req.ip
        });

        res.json({ status: true, message: 'تم رفض الدفعة بنجاح' });

        // إرسال تنبيه للمستخدم بالرفض مع السبب
        await createNotification(
            transaction.customerId,
            `نأسف، تم رفض طلب اشتراكك. السبب: ${reason}`,
            'subscription_rejection',
            { transactionId: transaction._id, reason }
        );
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// --- إدارة خطط الاشتراك ---
exports.createPlan = async (req, res) => {
    try {
        const plan = await Plan.create(req.body);
        res.status(201).json({ status: true, data: plan });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.getPlans = async (req, res) => {
    try {
        const plans = await Plan.find().sort({ price: 1 });
        res.json({ status: true, data: plans });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.updatePlan = async (req, res) => {
    try {
        const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ status: true, data: plan });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.deletePlan = async (req, res) => {
    try {
        await Plan.findByIdAndDelete(req.params.id);
        res.json({ status: true, message: 'تم حذف الخطة بنجاح' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// --- إدارة الاشتراكات والمدفوعات ---
exports.getAllTransactions = async (req, res) => {
    try {
        const transactions = await Transaction.aggregate([
            {
                $lookup: {
                    from: 'users',
                    localField: 'customerId',
                    foreignField: 'customerId',
                    as: 'user'
                }
            },
            {
                $unwind: {
                    path: '$user',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 1,
                    customerId: 1,
                    amount: 1,
                    paymentMethod: 1,
                    status: 1,
                    referenceNumber: 1,
                    planRequested: 1,
                    notes: 1,
                    processedBy: 1,
                    processedAt: 1,
                    createdAt: 1,
                    'user.username': 1,
                    'user.email': 1,
                    'user.companyName': 1
                }
            },
            { $sort: { createdAt: -1 } }
        ]);

        res.json({ status: true, data: transactions });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.updateUserSubscription = async (req, res) => {
    try {
        const { userId } = req.params;
        const { planType, status, endDate, reason } = req.body;

        if (!reason) return res.status(400).json({ status: false, message: 'يجب ذكر سبب التعديل اليدوي' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ status: false, message: 'المستخدم غير موجود' });

        let plan = null;
        if (planType) {
            plan = await Plan.findOne({ id: planType });
            if (!plan) return res.status(400).json({ status: false, message: `نوع الخطة غير صالح: ${planType} غير موجود` });
        }

        const updateData = {};
        if (planType) {
            updateData.planType = planType;
            updateData.limits = plan.limits;
        }
        if (status) updateData.status = status;
        if (endDate) updateData.endDate = new Date(endDate);

        const subscription = await Subscription.findOneAndUpdate(
            { customerId: user.customerId },
            updateData,
            { upsert: true, new: true }
        );

        // تسجيل العملية في AuditLog
        await AuditLog.create({
            action: 'MANUAL_SUBSCRIPTION_UPDATE',
            customerId: user.customerId,
            details: { 
                planType, 
                status, 
                reason, 
                performedBy: req.user.username 
            },
            ipAddress: req.ip
        });

        res.json({ 
            status: true, 
            message: 'تم تحديث بيانات الاشتراك بنجاح', 
            data: subscription 
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.getAuditLogs = async (req, res) => {
    try {
        const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
        res.json({ status: true, data: logs });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.deleteAuditLogs = async (req, res) => {
    try {
        const { logIds } = req.body;
        if (!logIds || !Array.isArray(logIds)) {
            return res.status(400).json({ status: false, message: 'Invalid log IDs provided' });
        }

        await AuditLog.deleteMany({ _id: { $in: logIds } });

        res.json({ status: true, message: 'تم حذف سجلات التدقيق بنجاح' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
