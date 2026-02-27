const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Expense = require('../models/Expense');
const Purchase = require('../models/Purchase');

exports.getProfitSummary = async (req, res) => {
    try {
        const cid = req.customerId;
        const purchases = await Purchase.find({ customerId: cid }).sort({ date: -1 }).limit(100);
        const totalPurchasesAgg = await Purchase.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        // حساب إجمالي المبيعات
        const totalSales = await SaleInvoice.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: "$total" } } }
        ]);

        // حساب إجمالي تكلفة الشراء
        const totalCOGS = await SaleInvoice.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: { $multiply: ["$quantity", "$costPrice"] } } } }
        ]);

        // حساب إجمالي التكاليف او المصروفات
        const expenses = await Expense.find({ customerId: cid }).sort({ date: -1 });
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);

        // حساب إجمالي الأرباح
        const netProfit = (totalSales[0]?.total || 0) - (totalCOGS[0]?.total || 0) - totalExpenses;

        res.render('profit', {
            // purchases,
            totalPurchases: totalPurchasesAgg[0]?.total || 0, // Keep for display if needed, but not for netProfit
            totalSales: totalSales[0]?.total || 0,
            totalCOGS: totalCOGS[0]?.total || 0,
            netProfit,
            // expenses,
            totalExpenses,
            token: req.session.token // إضافة الرمز المميز هنا
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('خطأ في جلب البيانات');
    }
};

exports.addPurchaseAdjustment = async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const val = parseFloat(amount);
        await Purchase.create({
            customerId: req.customerId,
            description: reason || 'تعديل يدوي لإجمالي المشتريات',
            amount: val,
            type: 'adjustment',
            reason: reason || ''
        });
        res.redirect('/profit');
    } catch (error) {
        console.error(error);
        res.status(500).send('خطأ في إضافة التعديل');
    }
};

exports.addPurchaseAdjustmentApi = async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const val = amount; // Already a number due to Joi validation
        const doc = await Purchase.create({
            customerId: req.customerId,
            description: reason || 'تعديل يدوي لإجمالي المشتريات',
            amount: val,
            type: 'adjustment',
            reason: reason || ''
        });
        return res.status(201).json({ status: true, message: 'تم إضافة التعديل', data: doc });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: 'خطأ في إضافة التعديل' });
    }
};

exports.getProfitSummaryJson = async (req, res) => {
    try {
        const cid = req.customerId;
        const purchases = await Purchase.find({ customerId: cid }).sort({ date: -1 }).limit(100);
        const totalPurchasesAgg = await Purchase.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalSales = await SaleInvoice.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: "$total" } } }
        ]);

        const totalCOGS = await SaleInvoice.aggregate([
            { $match: { customerId: cid } },
            { $group: { _id: null, total: { $sum: { $multiply: ["$quantity", "$costPrice"] } } } }
        ]);

        const expenses = await Expense.find({ customerId: cid }).sort({ date: -1 });
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);

        const netProfit = (totalSales[0]?.total || 0) - (totalCOGS[0]?.total || 0) - totalExpenses;
        res.json({
            status: true,
            data: {
                customerId: cid,
                purchases,
                totalPurchases: totalPurchasesAgg[0]?.total || 0,
                totalSales: totalSales[0]?.total || 0,
                totalCOGS: totalCOGS[0]?.total || 0,
                totalExpenses,
                netProfit
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: 'خطأ في جلب البيانات' });
    }
};
