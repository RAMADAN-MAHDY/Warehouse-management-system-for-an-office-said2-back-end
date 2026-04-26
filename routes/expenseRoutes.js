const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');

const { checkSubscription, checkLimit } = require('../middleware/subscriptionMiddleware');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);
router.use(checkSubscription);

// Get all expenses for current user (JSON API)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const filter = { customerId: req.customerId };

        const total = await Expense.countDocuments(filter);
        const stats = await Expense.aggregate([
            { $match: filter },
            { $group: { _id: null, totalValue: { $sum: "$amount" } } }
        ]);
        const totalExpensesValue = stats[0]?.totalValue || 0;

        const expenses = await Expense.find(filter)
            .sort({ date: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        res.status(200).json({
            status: true,
            message: 'Expenses fetched',
            data: expenses,
            totalExpensesValue,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

// Add new expense (JSON API)
router.post('/', checkLimit('expenses'), async (req, res) => {
    try {
        const { description, amount } = req.body;
        if (!description || amount === undefined) {
            return res.status(400).json({ status: false, message: 'Description and amount are required' });
        }
        const expense = await Expense.create({
            customerId: req.customerId,
            description,
            amount: Number(amount)
        });
        res.status(201).json({ status: true, message: 'Expense added', data: expense });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

// Update expense (JSON API)
router.put('/:id', async (req, res) => {
    try {
        const { description, amount } = req.body;
        const expense = await Expense.findOneAndUpdate(
            { _id: req.params.id, customerId: req.customerId },
            { description, amount: Number(amount) },
            { new: true }
        );
        if (!expense) return res.status(404).json({ status: false, message: 'Expense not found' });
        res.status(200).json({ status: true, message: 'Expense updated', data: expense });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

// Delete expense (JSON API)
router.delete('/:id', async (req, res) => {
    try {
        const expense = await Expense.findOneAndDelete({ _id: req.params.id, customerId: req.customerId });
        if (!expense) return res.status(404).json({ status: false, message: 'Expense not found' });
        res.status(200).json({ status: true, message: 'Expense deleted' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

module.exports = router;
