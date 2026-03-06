const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protectMiddleware = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (!token) {
        return res.status(401).json({ status: false, message: 'Not authorized, no token', data: null });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select('-password');
        if (!req.user) throw new Error('User not found');
        
        if (req.user.isBanned) {
            return res.status(403).json({ status: false, message: 'تم حظر حسابك. يرجى التواصل مع الإدارة.', data: null });
        }

        // نقل customerId إلى req مباشرةً لسهولة الوصول
        req.customerId = req.user.customerId;
        next();
    } catch (error) {
        return res.status(401).json({ status: false, message: 'Not authorized, token failed', data: null });
    }
};

module.exports = protectMiddleware;
