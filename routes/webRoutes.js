const express = require('express');
const Item = require('../models/Item');
const requireLogin = require('../middleware/requireLogin');
const SaleInvoice = require('../models/SaleInvoice');
const exportExcel = require('../utils/exportExcel');
const User = require('../models/User');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
const profitController = require('../controllers/profitController');
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const jwt = require('jsonwebtoken');
const { generateUniqueCustomerId } = require('../utils/generateCustomerId');
const router = express.Router();

/**
 * مساعد: يُرجع customerId الحقيقي من session token
 * يفك تشفير JWT ثم يجلب المستخدم من قاعدة البيانات
 */
async function getCustomerIdFromSession(req) {
    if (!req.session || !req.session.token) return null;
    try {
        const decoded = jwt.verify(req.session.token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('customerId');
        return user ? user.customerId : null;
    } catch (err) {
        return null;
    }
}

// تصدير فواتير المبيعات إلى إكسل حسب الفترة
router.get('/sales/export', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        const { from, to } = req.query;
        let query = { customerId };
        if (from && to) {
            const start = new Date(from);
            const end = new Date(to);
            end.setDate(end.getDate() + 1);
            query.createdAt = { $gte: start, $lt: end };
        } else if (from) {
            query.createdAt = { $gte: new Date(from) };
        } else if (to) {
            query.createdAt = { $lte: new Date(to) };
        }
        const sales = await SaleInvoice.find(query);
        const data = sales.map(sale => ({
            رقم_الفاتورة: sale._id.toString(),
            التاريخ: sale.createdAt ? sale.createdAt.toISOString().slice(0, 10) : '',
            المنتج: sale.name,
            الكمية: sale.quantity,
            السعر: sale.price,
            الإجمالي: sale.total
        }));
        const buffer = exportExcel(data, 'فواتير المبيعات');
        res.setHeader('Content-Disposition', 'attachment; filename="sales.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        res.status(500).send('خطأ في تصدير الفواتير');
    }
});
// صفحة تعديل فاتورة بيع
router.get('/sales/edit/:id', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        const sale = await SaleInvoice.findOne({ _id: req.params.id, customerId });
        if (!sale) return res.status(404).send('فاتورة غير موجودة');
        res.render('editSale', {
            sale: {
                ...sale.toObject(),
                itemName: '',
                sellerName: sale.sellerName
            }
        });
    } catch {
        res.status(500).send('خطأ في جلب الفاتورة');
    }
});

// تنفيذ تعديل فاتورة بيع
router.post('/sales/edit/:id', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        const { quantity, price, sellerName } = req.body;
        const sale = await SaleInvoice.findOne({ _id: req.params.id, customerId });
        if (!sale) return res.status(404).send('فاتورة غير موجودة');
        sale.quantity = quantity;
        sale.price = price;
        sale.total = quantity * price;
        sale.sellerName = sellerName;
        await sale.save();
        res.redirect('/sales');
    } catch {
        res.status(500).send('خطأ في تعديل الفاتورة');
    }
});

// حذف فاتورة بيع
router.post('/sales/delete/:id', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        await SaleInvoice.findOneAndDelete({ _id: req.params.id, customerId });
        res.redirect('/sales');
    } catch {
        res.status(500).send('خطأ في حذف الفاتورة');
    }
});

// Root route: show home page
router.get('/', (req, res) => {
    res.render('home');
});

// Login page
router.get('/login', (req, res) => res.render('login', { error: null }));

// Login handler
// Login handler: authenticate against API and store JWT
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const axios = require('axios');
        const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`;
        const response = await axios.post(`${apiUrl}/api/auth/login`, { username, password });
        if (response.data.status && response.data.data.token) {
            req.session.loggedIn = true;
            req.session.token = response.data.data.token;
            return res.redirect('/dashboard');
        }
        res.render('login', { error: response.data.message || 'Invalid credentials' });
    } catch (err) {
        console.error('Login error:', err.message || err);
        if (err.response && err.response.data && err.response.status === 400) {
            return res.render('login', { error: err.response.data.message || 'بيانات غير صحيحة' });
        }
        if (!err.response) {
            return res.render('login', { error: 'تعذر الاتصال بخادم المصادقة. تحقق من تشغيل الخادم.' });
        }
        res.render('login', { error: 'حدث خطأ غير متوقع أثناء تسجيل الدخول' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// Dashboard - يجلب المنتجات الخاصة بالعميل فقط
router.get('/dashboard', requireLogin, async (req, res) => {
    try {
        // ✅ الإصلاح: نجلب customerId الحقيقي من User model وليس decoded.id
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) {
            return res.redirect('/login');
        }
        // جلب منتجات هذا العميل فقط
        const invoices = await Item.find({ customerId }).sort({ createdAt: -1 });
        res.render('dashboard', { invoices, token: req.session.token });
    } catch (error) {
        console.error('Dashboard route error:', error);
        res.render('dashboard', { invoices: [], token: req.session.token || '' });
    }
});

// عرض فواتير المبيعات مع فلترة التاريخ - معزولة بـ customerId
router.get('/sales', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        const { from, to } = req.query;
        let query = { customerId }; // ✅ الإصلاح: فلترة بـ customerId
        if (from && to) {
            const start = new Date(from);
            const end = new Date(to);
            end.setDate(end.getDate() + 1);
            query.createdAt = { $gte: start, $lt: end };
        } else if (from) {
            query.createdAt = { $gte: new Date(from) };
        } else if (to) {
            query.createdAt = { $lte: new Date(to) };
        }
        const sales = await SaleInvoice.find(query);
        const salesWithNames = sales.map(sale => ({
            ...sale.toObject(),
            itemName: ''
        }));
        res.render('sales', {
            sales: salesWithNames,
            token: req.session.token,
            error: null,
            from: req.query.from || '',
            to: req.query.to || ''
        });
    } catch (err) {
        console.error(err);
        res.render('sales', {
            sales: [],
            token: req.session.token,
            error: 'حدث خطأ أثناء جلب الفواتير',
            from: req.query.from || '',
            to: req.query.to || ''
        });
    }
});


// عرض ملفات الإكسل المحفوظة
router.get('/excel-files', requireLogin, async (req, res) => {
    try {
        const InvoiceFile = require('../models/InvoiceFile');
        const files = await InvoiceFile.find().sort({ createdAt: -1 });
        res.render('excelFiles', { files, token: req.session.token });
    } catch (err) {
        console.error(err);
        res.status(500).send('خطأ في جلب ملفات الإكسل');
    }
});

// حذف ملف إكسل
router.post('/excel-files/delete/:id', requireLogin, async (req, res) => {
    try {
        const InvoiceFile = require('../models/InvoiceFile');
        await InvoiceFile.findByIdAndDelete(req.params.id);
        res.redirect('/excel-files');
    } catch (err) {
        console.error(err);
        res.status(500).send('خطأ في حذف ملف الإكسل');
    }
});


// عرض صفحة التسجيل
router.get('/register', (req, res) => {
    res.render('register', { error: null, success: null });
});

router.post('/register', async (req, res) => {
    const { username, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.render('register', { error: 'كلمتا المرور غير متطابقتين', success: null });
    }

    try {
        const userExists = await User.findOne({ username });
        if (userExists) {
            return res.render('register', { error: 'اسم المستخدم موجود بالفعل', success: null });
        }
        // ✅ الإصلاح: توليد customerId عند التسجيل من صفحة الويب أيضاً
        const customerId = await generateUniqueCustomerId(User);
        await User.create({ username, password, customerId });

        res.render('register', {
            success: `تم إنشاء الحساب بنجاح! معرفك: ${customerId}. يمكنك تسجيل الدخول الآن.`,
            error: null,
        });
    } catch (err) {
        console.error(err);
        res.render('register', { error: 'حدث خطأ أثناء إنشاء الحساب', success: null });
    }
});

// صفحة المشتريات والمبيعات وصافي الربح
router.get('/profit', requireLogin, async (req, res, next) => {
    // ✅ حقن customerId في req قبل استدعاء profitController
    const customerId = await getCustomerIdFromSession(req);
    if (!customerId) return res.redirect('/login');
    req.customerId = customerId;

    next();
}, profitController.getProfitSummary);

router.post('/purchases/adjust', requireLogin, async (req, res, next) => {
    const customerId = await getCustomerIdFromSession(req);
    if (!customerId) return res.redirect('/login');
    req.customerId = customerId;
    next();
}, profitController.addPurchaseAdjustment);

router.get('/api/profit', protect, tenantMiddleware, profitController.getProfitSummaryJson);
const { profitAdjustmentSchema } = require('../validations/reportValidation');
const validate = require('../middleware/validateMiddleware');
router.post('/api/purchases/adjust', protect, tenantMiddleware, validate(profitAdjustmentSchema), profitController.addPurchaseAdjustmentApi);
router.get('/purchases', requireLogin, async (req, res) => {
    res.render('purchases', { token: req.session.token });
});

// صفحة المصروفات - معزولة بـ customerId
router.get('/expenses', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        const expenses = await Expense.find({ customerId });
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        res.render('expenses', { expenses, totalExpenses });
    } catch (error) {
        res.status(500).send('خطأ في جلب البيانات');
    }
});

// إضافة مصروف جديد
router.post('/expenses/add', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        const { description, amount } = req.body;
        if (!description || !amount) return res.status(400).send('يرجى إدخال جميع البيانات');
        await Expense.create({ customerId, description, amount });
        res.redirect('/expenses');
    } catch (error) {
        res.status(500).send('خطأ في إضافة المصروف');
    }
});

// تعديل مصروف - معزول بـ customerId
router.post('/expenses/edit/:id', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        const { description, amount } = req.body;
        if (!description || !amount) return res.status(400).send('يرجى إدخال جميع البيانات');
        await Expense.findOneAndUpdate({ _id: req.params.id, customerId }, { description, amount });
        res.redirect('/expenses');
    } catch (error) {
        res.status(500).send('خطأ في تعديل المصروف');
    }
});

// عرض فورم التعديل لمصروف (GET)
router.get('/expenses/edit/:id', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        const editExpense = await Expense.findOne({ _id: req.params.id, customerId });
        const expenses = await Expense.find({ customerId });
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        res.render('expenses', { expenses, totalExpenses, editExpense });
    } catch (error) {
        res.status(500).send('خطأ في تعديل المصروف');
    }
});

// حذف مصروف - معزول بـ customerId
router.post('/expenses/delete/:id', requireLogin, async (req, res) => {
    try {
        const customerId = await getCustomerIdFromSession(req);
        if (!customerId) return res.redirect('/login');
        await Expense.findOneAndDelete({ _id: req.params.id, customerId });
        res.redirect('/expenses');
    } catch (error) {
        res.status(500).send('خطأ في حذف المصروف');
    }
});

module.exports = router;
