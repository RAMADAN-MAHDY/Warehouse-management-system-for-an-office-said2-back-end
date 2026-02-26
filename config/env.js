const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.join(__dirname, '../.env') });
}

const requiredEnvVars = [
    'MONGO_URI',
    'JWT_SECRET',
    'NODE_ENV'
    // 'SENTRY_DSN' // Optional but recommended for production
];

const validateEnv = () => {
    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);

    if (missing.length > 0) {
        console.error('❌ Missing mandatory environment variables:', missing.join(', '));
        process.exit(1);
    }

    console.log('✅ Environment variables validated successfully.');
};

module.exports = {
    validateEnv,
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT || 5000,
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    SENTRY_DSN: process.env.SENTRY_DSN
};
