const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const PurchaseBackup = require('../models/PurchaseBackup');
const AuditLog = require('../models/AuditLog');
const Item = require('../models/Item'); // استيراد نموذج المنتج

exports.list = async (req, res) => {
    try {
        const purchases = await Purchase.find({ customerId: req.customerId }).populate('itemId').sort({ date: -1 });

        res.status(200).json({ status: true, message: 'Purchases', data: purchases });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.create = async (req, res) => {
    try {
        const { modelNumber, name, quantity, price, supplier, date } = req.body;

        // البحث عن المنتج المرتبط
        const item = await Item.findOne({ customerId: req.customerId, modelNumber, name });
        if (!item) {
            return res.status(404).json({ status: false, message: 'Item not found. Please create the item first.', data: null });
        }

        // حساب المبلغ الإجمالي للشراء
        const purchaseAmount = Number(price) * Number(quantity);

        // تحديث كمية المنتج وسعر التكلفة (المتوسط المرجح)
        const oldTotalCost = item.quantity * item.costPrice;
        const newTotalCost = oldTotalCost + purchaseAmount;
        const newQuantity = item.quantity + Number(quantity);
        const newCostPrice = newQuantity > 0 ? newTotalCost / newQuantity : 0;

        item.quantity = newQuantity;
        item.costPrice = newCostPrice;
        await item.save();

        const doc = await Purchase.create({
            customerId: req.customerId,
            description: `شراء ${name} (${modelNumber}) من ${supplier}`,
            amount: purchaseAmount,
            date: date ? new Date(date) : undefined,
            type: 'purchase',
            reason: '',
            itemId: item._id, // ربط الشراء بالمنتج
            modelNumber,
            name,
            quantity,
            price,
            supplier
        });
        await AuditLog.create({
            customerId: req.customerId,
            userId: req.user?._id,
            action: 'create',
            purchaseId: doc._id,
            changes: doc.toObject()
        });
        res.status(201).json({ status: true, message: 'Purchase created', data: doc });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { modelNumber, name, quantity, price, supplier, date } = req.body;
        const amount = Number(price) * Number(quantity);
        const before = await Purchase.findOne({ _id: id, customerId: req.customerId });
        if (!before) return res.status(404).json({ status: false, message: 'Purchase not found', data: null });
        const doc = await Purchase.findByIdAndUpdate(
            id,
            {
                description: `شراء ${name} (${modelNumber}) من ${supplier}`,
                amount,
                date: date ? new Date(date) : before.date,
                type: before.type,
                reason: before.reason,
                itemId: before.itemId,
                modelNumber,
                name,
                quantity,
                price,
                supplier
            },
            { new: true }
        );
        await AuditLog.create({
            customerId: req.customerId,
            userId: req.user?._id,
            action: 'update',
            purchaseId: doc._id,
            changes: { before, after: doc }
        });
        res.status(200).json({ status: true, message: 'Purchase updated', data: doc });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.addPurchaseAdjustmentApi = async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const val = amount; // Already a number due to Joi validation
        const doc = await Purchase.create({
            customerId: req.customerId,
            description: reason || 'تعديل يدوي لإجمالي المشتريات',
            amount: val,
            type: 'adjustment',
            reason: reason || ''
        });
        return res.status(201).json({ status: true, message: 'تم إضافة التعديل', data: doc });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: 'خطأ في إضافة التعديل' });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ status: false, message: 'Invalid id', data: null });
        const doc = await Purchase.findOne({ _id: id, customerId: req.customerId });
        if (!doc) return res.status(404).json({ status: false, message: 'Purchase not found', data: null });
        await PurchaseBackup.create({ ...doc.toObject(), originalId: doc._id });
        await Purchase.findByIdAndDelete(id);
        await AuditLog.create({
            customerId: req.customerId,
            userId: req.user?._id,
            action: 'delete',
            purchaseId: id,
            changes: { deleted: doc }
        });
        res.status(200).json({ status: true, message: 'Purchase deleted', data: null });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};
