const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const connectDB = require('../config/db');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables only in development
if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: './.env' });
}

const app = express();

// إعدادات أساسية
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('Database Connection Error:', err.message);
        // Don't hang, return error if DB fails
        if (req.path === '/api/health') return next(); // Let health check handle it
        res.status(503).json({
            status: false,
            message: 'Database connection failed. Please check environment variables.'
        });
    }
});

// جلسات المستخدمين
app.use(session({
    secret: process.env.JWT_SECRET || 'default_secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        ttl: 24 * 60 * 60, // يوم كامل
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000,
    },
}));

// إعداد EJS و static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));
app.set('trust proxy', 1);

// مسار فحص الصحة (Health Check)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        db_connected: !!process.env.MONGO_URI,
        timestamp: new Date().toISOString()
    });
});

// المسارات
app.use('/', require('../routes/webRoutes'));
app.use('/api/items', require('../routes/itemRoutes'));
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/sales', require('../routes/saleRoutes'));
app.use('/api/purchases', require('../routes/purchaseRoutes'));
app.use('/api/reports', require('../routes/reportRoutes'));

// معالجة الأخطاء
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
});

// ✅ Vercel handles the express app directly
module.exports = app;

// ✅ إضافة مستمع في وضع التطوير فقط
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running in development mode on http://localhost:${PORT}`);
    });
}
