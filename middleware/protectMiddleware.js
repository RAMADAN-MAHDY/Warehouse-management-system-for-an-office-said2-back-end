const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protectMiddleware = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ status: false, message: 'Not authorized, no token', data: null });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select('-password');
        if (!req.user) throw new Error('User not found');
        // نقل customerId إلى req مباشرةً لسهولة الوصول
        req.customerId = req.user.customerId;
        console.log('Protect Middleware: req.customerId set to', req.customerId); // إضافة سجل هنا
        next();
    } catch (error) {
        return res.status(401).json({ status: false, message: 'Not authorized, token failed', data: null });
    }
};

module.exports = protectMiddleware;
