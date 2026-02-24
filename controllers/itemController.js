const mongoose = require('mongoose');
const Item = require('../models/Item');
const Purchase = require('../models/Purchase');
const exportExcel = require('../utils/exportExcel');
const Expense = require('../models/Expense');

// حذف عنصر من قاعدة البيانات
exports.deleteItem = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ status: false, message: 'Invalid item id', data: null });
        }
        // تأكد من أن العنصر ينتمي لنفس العميل
        const item = await Item.findOneAndDelete({ _id: req.params.id, customerId: req.customerId });
        if (!item) return res.status(404).json({ status: false, message: 'Item not found', data: null });
        res.status(200).json({ status: true, message: 'Item deleted', data: null });
    } catch (error) {
        console.error('Delete Item Error:', error);
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getAllItems = async (req, res) => {
    try {
        const items = await Item.find({ customerId: req.customerId });
        res.status(200).json({ status: true, message: 'Items fetched', data: items });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.searchItems = async (req, res) => {
    try {
        const { search: q } = req.query;
        const items = await Item.find({
            customerId: req.customerId,
            $or: [
                { modelNumber: { $regex: q, $options: 'i' } },
                { name: { $regex: q, $options: 'i' } },
            ],
        });
        res.status(200).json({ status: true, message: 'Search results', data: items });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.addItem = async (req, res) => {
    try {
        const { modelNumber, name, quantity, price, customer } = req.body;
        // إضافة customerId تلقائياً من بيانات المستخدم المسجّل
        const item = await Item.create({ modelNumber, name, quantity, price, costPrice: price, customer, customerId: req.customerId });
        const fullItem = await Item.findById(item._id);
        try {
            await Purchase.create({
                customerId: req.customerId,
                description: `شراء ${fullItem.name} (${fullItem.modelNumber}) من ${fullItem.customer}`,
                amount: Number(fullItem.price) * Number(fullItem.quantity),
                type: 'purchase',
                itemId: fullItem._id
            });
        } catch (e) {
            console.error('Add Purchase ledger failed:', e);
        }
        res.status(201).json({ status: true, message: 'Item added', data: fullItem });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.updateItem = async (req, res) => {
    try {
        const { modelNumber, name, quantity, price, customer } = req.body;
        // التحقق من ملكية العنصر وتحديثه
        const item = await Item.findOneAndUpdate(
            { _id: req.params.id, customerId: req.customerId },
            { modelNumber, name, quantity, price, costPrice: price, customer },
            { new: true }
        );
        if (!item) return res.status(404).json({ status: false, message: 'Item not found', data: null });
        try {
            const updated = await Purchase.findOneAndUpdate(
                { itemId: req.params.id, type: 'purchase', customerId: req.customerId },
                { description: `تحديث شراء ${item.name} (${item.modelNumber}) من ${item.customer}`, amount: Number(item.price) * Number(item.quantity) },
                { new: true }
            );
            if (!updated) {
                await Purchase.create({
                    customerId: req.customerId,
                    description: `شراء ${item.name} (${item.modelNumber}) من ${item.customer}`,
                    amount: Number(item.price) * Number(item.quantity),
                    type: 'purchase',
                    itemId: item._id
                });
            }
        } catch (e) {
            console.error('Update Purchase ledger failed:', e);
        }
        res.status(200).json({ status: true, message: 'Item updated', data: item });
    } catch (error) {
        console.error('Update Item Error:', error);
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.exportToExcel = async (req, res) => {
    try {
        const items = await Item.find({ customerId: req.customerId });
        const buffer = await exportExcel(items);
        const InvoiceFile = require('../models/InvoiceFile');
        const invoiceFile = await InvoiceFile.create({ buffer });
        res.status(200).json({ status: true, message: 'Exported to Excel', data: { id: invoiceFile._id } });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

// Download Excel file from MongoDB
exports.downloadExcel = async (req, res) => {
    try {
        const InvoiceFile = require('../models/InvoiceFile');
        const file = await InvoiceFile.findById(req.params.id);
        if (!file) return res.status(404).json({ status: false, message: 'File not found', data: null });
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="invoices.xlsx"',
        });
        res.send(file.buffer);
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

// مصروفات
exports.updateExpense = async (req, res) => {
    try {
        const { description, amount } = req.body;
        const expense = await Expense.findOneAndUpdate(
            { _id: req.params.id, customerId: req.customerId },
            { description, amount },
            { new: true }
        );
        if (!expense) return res.status(404).json({ status: false, message: 'Expense not found', data: null });
        res.status(200).json({ status: true, message: 'Expense updated', data: expense });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.deleteExpense = async (req, res) => {
    try {
        const expense = await Expense.findOneAndDelete({ _id: req.params.id, customerId: req.customerId });
        if (!expense) return res.status(404).json({ status: false, message: 'Expense not found', data: null });
        res.status(200).json({ status: true, message: 'Expense deleted', data: null });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};
