const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const connectDB = require('../config/db');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');
const { validateEnv, MONGO_URI, JWT_SECRET, NODE_ENV, PORT, CORS_ORIGIN, SENTRY_DSN } = require('../config/env');

// Validate environment variables immediately
validateEnv();

const app = express();

// Initialize Sentry
if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        integrations: [
            nodeProfilingIntegration(),
        ],
        // Performance Monitoring
        tracesSampleRate: 1.0, //  Capture 100% of the transactions
        // Set sampling rate for profiling - this is relative to tracesSampleRate
        profilesSampleRate: 1.0,
        environment: NODE_ENV
    });
}

// Request logging
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// The Sentry request handler must be the first middleware on the app
if (SENTRY_DSN) {
    app.use(Sentry.Handlers.requestHandler());
    // TracingHandler creates a trace for every incoming request
    app.use(Sentry.Handlers.tracingHandler());
}

// Security Middlewares
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
            connectSrc: ["'self'", "https://sentry.io", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            mediaSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
})); // Sets various HTTP headers for security with custom CSP

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: false, message: 'Too many requests from this IP, please try again after 15 minutes' }
});
app.use('/api/', limiter);

// CORS configuration with allowlist
const corsOptions = {
    origin: (origin, callback) => {
        const allowlist = CORS_ORIGIN.split(',').map(item => item.trim());
        if (!origin || allowlist.indexOf(origin) !== -1 || allowlist.includes('*')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Connect to Database only if not in test environment
if (NODE_ENV !== 'test') {
    connectDB().catch(err => {
        console.error('Initial Database Connection Error:', err.message);
    });
}

// جلسات المستخدمين
app.use(session({
    secret: JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        ttl: 24 * 60 * 60, // يوم كامل
    }),
    cookie: {
        secure: NODE_ENV === 'production',
        sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
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
        environment: NODE_ENV,
        db_connected: !!MONGO_URI,
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

// The Sentry error handler must be before any other error middleware and after all controllers
if (SENTRY_DSN) {
    app.use(Sentry.Handlers.errorHandler());
}

// معالجة الأخطاء
app.use((err, req, res, next) => {
    // If Sentry is not initialized, we still want to log the error
    if (!SENTRY_DSN) {
        console.error('Server Error:', err);
    }
    
    const statusCode = err.status || 500;
    res.status(statusCode).json({ 
        status: false, 
        message: NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
        ...(NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// ✅ Vercel handles the express app directly
module.exports = app;

// ✅ إضافة مستمع في وضع التطوير فقط
if (NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running in development mode on http://localhost:${PORT}`);
    });
}
