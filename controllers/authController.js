const User = require('../models/User');
const Subscription = require('../models/Subscription');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateUniqueCustomerId } = require('../utils/generateCustomerId');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

exports.registerUser = async (req, res) => {
    try {
        const { username, password, companyName ,role } = req.body;
// console.log("----------------------------------------------");
// console.log(role);
        const userExists = await User.findOne({ username });
        if (userExists) {
            return res.status(400).json({ status: false, message: 'Username already exists', data: null });
        }

        // توليد معرف عميل فريد
        const customerId = await generateUniqueCustomerId(User);

        const user = await User.create({ username, password, customerId, companyName: companyName || '', role:'admin' });

        // إنشاء اشتراك تجريبي مجاني لمدة شهر
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);

        await Subscription.create({
            customerId,
            planType: 'free',
            status: 'active',
            startDate: new Date(),
            endDate,
            limits: {
                maxItems: 200, // منح صلاحيات احترافية مؤقتاً
                maxSales: 200,
                maxExpenses: 200
            }
        });

        const token = generateToken(user._id);

        // ضبط توكن في كوكيز (HttpOnly) للأمان
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        return res.status(201).json({
            status: true,
            message: 'User registered successfully',
            data: {
                user: user.toJSON(),
                customerId,
                // لم نعد نرسل التوكن في الجسم لزيادة الأمان
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.loginUser = async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username }).select("+password");
        if (!user) {
            return res.status(400).json({ status: false, message: 'Invalid credentials', data: null });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ status: false, message: 'Invalid credentials', data: null });
        }

        const token = generateToken(user._id);

        // ضبط توكن في كوكيز (HttpOnly) للأمان
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        return res.status(200).json({
            status: true,
            message: 'Login successful',
            data: {
                user: user.toJSON(),
                customerId: user.customerId,
                // لم نعد نرسل التوكن في الجسم لزيادة الأمان
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getMe = async (req, res) => {
    try {
        return res.status(200).json({
            status: true,
            message: 'User details',
            data: {
                user: req.user,
                customerId: req.user.customerId
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.logoutUser = async (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax'
    });
    res.json({ status: true, message: 'Logged out successfully' });
};
