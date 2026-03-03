const express = require('express');
const connectDB = require('../config/db');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const compression = require('compression');
const hpp = require('hpp');
const mongoose = require('mongoose');
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

const {
  validateEnv,
  MONGO_URI,
  NODE_ENV,
  PORT,
  CORS_ORIGIN,
  SENTRY_DSN
} = require('../config/env');

const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const { getProfitSummaryJson } = require('../controllers/reportController');

validateEnv();

const app = express();

app.set('trust proxy', 1);

/* ===========================
   SENTRY INITIALIZATION
=========================== */
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: NODE_ENV === 'production' ? 0.2 : 1.0,
    profilesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
    environment: NODE_ENV,
  });

  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

/* ===========================
   LOGGING
=========================== */
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

/* ===========================
   SECURITY MIDDLEWARES
=========================== */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
        connectSrc: ["'self'", "https://sentry.io"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);

app.use(hpp());
app.use(compression());

/* ===========================
   RATE LIMITING
=========================== */

// Auth endpoints – حماية أقوى
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// باقي API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

/* ===========================
   CORS (Production Ready)
=========================== */

const normalizeOrigin = (origin) => origin?.replace(/\/$/, '');

const envAllowlist = (CORS_ORIGIN || '')
  .split(',')
  .map((item) => normalizeOrigin(item.trim()))
  .filter(Boolean);

const STATIC_ALLOWED_ORIGINS = [
  'https://warehouse-management-system-for-an-sooty.vercel.app'
];

const allowlist = new Set([
  ...envAllowlist,
  ...STATIC_ALLOWED_ORIGINS.map(normalizeOrigin),
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Postman / Server-side

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowlist.has(normalizedOrigin)) {
        return callback(null, true);
      }

      console.warn(`Blocked CORS origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

/* ===========================
   BODY PARSING
=========================== */

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

/* ===========================
   DATABASE CONNECTION (Cached for Serverless)
=========================== */

if (NODE_ENV !== 'test') {
  if (!global._mongoose) {
    global._mongoose = connectDB();
  }
}

/* ===========================
   HEALTH CHECK
=========================== */

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: NODE_ENV,
    db_connected: mongoose.connection.readyState === 1,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/* ===========================
   ROUTES
=========================== */

app.get('/api/profit', protect, tenantMiddleware, getProfitSummaryJson);

app.use('/api/items', require('../routes/itemRoutes'));
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/sales', require('../routes/saleRoutes'));
app.use('/api/purchases', require('../routes/purchaseRoutes'));
app.use('/api/expenses', require('../routes/expenseRoutes'));
app.use('/api/excel-files', require('../routes/excelRoutes'));
app.use('/api/reports', require('../routes/reportRoutes'));

/* ===========================
   ERROR HANDLING
=========================== */

if (SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

app.use((err, req, res, next) => {
  if (!SENTRY_DSN) {
    console.error(err);
  }

  const statusCode = err.status || 500;

  res.status(statusCode).json({
    status: false,
    message:
      NODE_ENV === 'production'
        ? 'Internal Server Error'
        : err.message,
    ...(NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

/* ===========================
   EXPORT (Vercel Compatible)
=========================== */

module.exports = app;

/* ===========================
   DEV LISTENER ONLY
=========================== */

if (NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}