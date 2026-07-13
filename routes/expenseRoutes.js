const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const { computePaymentStatus } = require('../utils/paymentStatus');

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
        const { description, amount, paidAmount: reqPaidAmount } = req.body;
        if (!description || amount === undefined) {
            return res.status(400).json({ status: false, message: 'Description and amount are required' });
        }
        const finalAmount = Number(amount);
        const paidAmount = Number(reqPaidAmount || 0);
        if (paidAmount > finalAmount) {
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed amount' });
        }
        const paymentStatus = computePaymentStatus(finalAmount, paidAmount);
        const expense = await Expense.create({
            customerId: req.customerId,
            description,
            amount: finalAmount,
            paidAmount,
            paymentStatus
        });
        res.status(201).json({ status: true, message: 'Expense added', data: expense });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

// Update expense (JSON API)
router.put('/:id', async (req, res) => {
    try {
        const { description, amount, paidAmount: reqPaidAmount } = req.body;
        
        const existingExpense = await Expense.findOne({ _id: req.params.id, customerId: req.customerId });
        if (!existingExpense) return res.status(404).json({ status: false, message: 'Expense not found' });

        const finalAmount = amount !== undefined ? Number(amount) : existingExpense.amount;
        const finalPaidAmount = reqPaidAmount !== undefined ? Number(reqPaidAmount) : existingExpense.paidAmount;
        
        if (finalPaidAmount > finalAmount) {
            return res.status(400).json({ status: false, message: 'Paid amount cannot exceed amount' });
        }

        const paymentStatus = computePaymentStatus(finalAmount, finalPaidAmount);

        const updatedExpense = await Expense.findOneAndUpdate(
            { _id: req.params.id, customerId: req.customerId },
            { 
                description, 
                amount: finalAmount,
                paidAmount: finalPaidAmount,
                paymentStatus
            },
            { new: true }
        );

        res.status(200).json({ status: true, message: 'Expense updated', data: updatedExpense });
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
