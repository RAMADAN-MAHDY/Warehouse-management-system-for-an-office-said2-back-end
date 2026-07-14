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
        const { page = 1, limit = 10, lowStock } = req.query;
        if (lowStock === 'true') {
            return exports.getLowStockItems(req, res);
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const filter = { customerId: req.customerId };

        const total = await Item.countDocuments(filter);
        const stats = await Item.aggregate([
            { $match: filter },
            { $group: { _id: null, totalValue: { $sum: { $multiply: ["$price", "$quantity"] } } } }
        ]);
        const totalInventoryValue = stats[0]?.totalValue || 0;

        const items = await Item.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        res.status(200).json({
            status: true,
            message: 'Items fetched',
            data: items,
            totalInventoryValue,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getLowStockItems = async (req, res) => {
    try {
        const { page = 1, limit = 10, category, minDeficit, maxDeficit } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;

        const match = { customerId: req.customerId };
        if (category) {
            const raw = String(category).trim();
            const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length > 1) match.category = { $in: parts };
            else match.category = raw;
        }

        const minDef = minDeficit !== undefined && minDeficit !== '' ? Number(minDeficit) : undefined;
        const maxDef = maxDeficit !== undefined && maxDeficit !== '' ? Number(maxDeficit) : undefined;

        const basePipeline = [
            { $match: match },
            {
                $addFields: {
                    minQuantityResolved: { $ifNull: ['$minQuantity', 5] },
                }
            },
            {
                $addFields: {
                    deficit: { $subtract: ['$minQuantityResolved', '$quantity'] },
                    isLowStock: { $lt: ['$quantity', '$minQuantityResolved'] }
                }
            },
            { $match: { isLowStock: true } }
        ];

        if (Number.isFinite(minDef) || Number.isFinite(maxDef)) {
            const deficitFilter = {};
            if (Number.isFinite(minDef)) deficitFilter.$gte = minDef;
            if (Number.isFinite(maxDef)) deficitFilter.$lte = maxDef;
            basePipeline.push({ $match: { deficit: deficitFilter } });
        }

        const [result] = await Item.aggregate([
            ...basePipeline,
            {
                $facet: {
                    data: [
                        { $sort: { deficit: -1, quantity: 1, createdAt: -1 } },
                        { $skip: skip },
                        { $limit: limitNum },
                        { $project: { minQuantityResolved: 0, isLowStock: 0 } }
                    ],
                    meta: [{ $count: 'total' }]
                }
            }
        ]);

        const total = result?.meta?.[0]?.total || 0;
        const data = result?.data || [];

        return res.status(200).json({
            status: true,
            message: 'Low stock items',
            data,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
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
                { customer: { $regex: q, $options: 'i' } },
            ],
        }).lean();
        res.status(200).json({ status: true, message: 'Search results', data: items });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.addItem = async (req, res) => {
    try {
        const { modelNumber, name, quantity, price, customer, costPrice, minQuantity, category } = req.body;
        // إضافة customerId تلقائياً من بيانات المستخدم المسجّل
        const item = await Item.create({
            modelNumber,
            name,
            quantity,
            price,
            costPrice: costPrice || 0,
            customer,
            minQuantity: minQuantity ?? 5,
            category: category || undefined,
            customerId: req.customerId
        });
        const fullItem = await Item.findById(item._id).lean();
        res.status(201).json({ status: true, message: 'Item added', data: fullItem });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.updateItem = async (req, res) => {
    try {
        const { modelNumber, name, quantity, price, customer, costPrice, minQuantity, category } = req.body;
        const updateFields = {};
        if (modelNumber !== undefined) updateFields.modelNumber = modelNumber;
        if (name !== undefined) updateFields.name = name;
        if (quantity !== undefined) updateFields.quantity = quantity;
        if (price !== undefined) updateFields.price = price;
        if (customer !== undefined) updateFields.customer = customer;
        if (costPrice !== undefined) updateFields.costPrice = costPrice;
        if (minQuantity !== undefined) updateFields.minQuantity = minQuantity;
        if (category !== undefined) updateFields.category = category || undefined;
        // التحقق من ملكية العنصر وتحديثه
        const item = await Item.findOneAndUpdate(
            { _id: req.params.id, customerId: req.customerId },
            updateFields,
            { new: true }
        );
        if (!item) return res.status(404).json({ status: false, message: 'Item not found', data: null });
        res.status(200).json({ status: true, message: 'Item updated', data: item });
    } catch (error) {
        console.error('Update Item Error:', error);
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.exportToExcel = async (req, res) => {
    try {
        const items = await Item.find({ customerId: req.customerId }).lean();
        
        if (!items || items.length === 0) {
            return res.status(404).json({ status: false, message: 'لا توجد بيانات لتصديرها' });
        }

        // Prepare data for Excel
        const data = items.map(item => ({
            'اسم الصنف': item.name || 'N/A',
            'رقم الموديل': item.modelNumber || 'N/A',
            'الكمية': item.quantity || 0,
            'الحد الأدنى': item.minQuantity ?? 5,
            'الفئة': item.category || '',
            'السعر': item.price || 0,
            'اسم العميل': item.customer || 'N/A',
            'تاريخ الإضافة': item.createdAt ? item.createdAt.toISOString().slice(0, 10) : ''
        }));

        const buffer = exportExcel(data, 'المخزون');
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=inventory.xlsx');
        res.send(buffer);
    } catch (error) {
        console.error('Export Excel Error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.exportLowStockToExcel = async (req, res) => {
    try {
        const { category, minDeficit, maxDeficit } = req.query;

        const match = { customerId: req.customerId };
        if (category) {
            const raw = String(category).trim();
            const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length > 1) match.category = { $in: parts };
            else match.category = raw;
        }

        const minDef = minDeficit !== undefined && minDeficit !== '' ? Number(minDeficit) : undefined;
        const maxDef = maxDeficit !== undefined && maxDeficit !== '' ? Number(maxDeficit) : undefined;

        const pipeline = [
            { $match: match },
            {
                $addFields: {
                    minQuantityResolved: { $ifNull: ['$minQuantity', 5] },
                }
            },
            {
                $addFields: {
                    deficit: { $subtract: ['$minQuantityResolved', '$quantity'] },
                    isLowStock: { $lt: ['$quantity', '$minQuantityResolved'] }
                }
            },
            { $match: { isLowStock: true } }
        ];

        if (Number.isFinite(minDef) || Number.isFinite(maxDef)) {
            const deficitFilter = {};
            if (Number.isFinite(minDef)) deficitFilter.$gte = minDef;
            if (Number.isFinite(maxDef)) deficitFilter.$lte = maxDef;
            pipeline.push({ $match: { deficit: deficitFilter } });
        }

        pipeline.push({ $sort: { deficit: -1, quantity: 1, createdAt: -1 } });
        pipeline.push({ $project: { minQuantityResolved: 0, isLowStock: 0 } });

        const items = await Item.aggregate(pipeline);
        if (!items || items.length === 0) {
            return res.status(404).json({ status: false, message: 'لا توجد نواقص لتصديرها', data: null });
        }

        const data = items.map(item => ({
            'اسم الصنف': item.name || 'N/A',
            'رقم الموديل': item.modelNumber || 'N/A',
            'الفئة': item.category || '',
            'الكمية الحالية': item.quantity || 0,
            'الحد الأدنى': item.minQuantity ?? 5,
            'الكمية الناقصة': Math.max(0, Number(item.minQuantity ?? 5) - Number(item.quantity || 0)),
            'السعر': item.price || 0,
            'اسم العميل': item.customer || 'N/A',
        }));

        const buffer = exportExcel(data, 'نواقص المخزون');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=low-stock.xlsx');
        res.send(buffer);
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

exports.getItemMovements = async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20, from, to } = req.query;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid item id', data: null });
        }

        const item = await Item.findOne({ _id: id, customerId: req.customerId }).lean();
        if (!item) {
            return res.status(404).json({ status: false, message: 'المنتج غير موجود', data: null });
        }

        const filter = { itemId: id, customerId: req.customerId };
        if (from || to) {
            filter.date = {};
            if (from) filter.date.$gte = new Date(from);
            if (to) {
                const endDate = new Date(to);
                endDate.setHours(23, 59, 59, 999);
                filter.date.$lte = endDate;
            }
        }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

        const [movements, total] = await Promise.all([
            mongoose.model('StockMovement').find(filter)
                .sort({ date: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            mongoose.model('StockMovement').countDocuments(filter)
        ]);

        return res.status(200).json({
            status: true,
            message: 'حركات الصنف المالي والكمي',
            data: {
                item,
                movements,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};
