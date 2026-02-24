const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateUniqueCustomerId } = require('../utils/generateCustomerId');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

exports.registerUser = async (req, res) => {
    try {
        const { username, password, companyName } = req.body;

        const userExists = await User.findOne({ username });
        if (userExists) {
            return res.status(400).json({ status: false, message: 'Username already exists', data: null });
        }

        // توليد معرف عميل فريد
        const customerId = await generateUniqueCustomerId(User);

        const user = await User.create({ username, password, customerId, companyName: companyName || '' });

        return res.status(201).json({
            status: true,
            message: 'User registered successfully',
            data: {
                user: user.toJSON(),
                customerId,
                token: generateToken(user._id)
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

        return res.status(200).json({
            status: true,
            message: 'Login successful',
            data: {
                user: user.toJSON(),
                customerId: user.customerId,
                token: generateToken(user._id)
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
