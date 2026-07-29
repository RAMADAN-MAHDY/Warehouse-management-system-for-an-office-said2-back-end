const Supplier = require('../models/Supplier');

exports.listSuppliers = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const filter = { customerId: req.customerId };

        const [data, total] = await Promise.all([
            Supplier.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            Supplier.countDocuments(filter)
        ]);

        res.status(200).json({
            status: true,
            message: 'Suppliers',
            data,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.createSupplier = async (req, res) => {
    try {
        const { name, phone, email, address } = req.body;

        const doc = await Supplier.create({
            customerId: req.customerId,
            name,
            phone,
            email,
            address,
            balance: 0
        });

        res.status(201).json({ status: true, message: 'Supplier created', data: doc });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ status: false, message: 'Supplier already exists', data: null });
        }
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await Supplier.findOne({ _id: id, customerId: req.customerId }).lean();
        if (!doc) {
            return res.status(404).json({ status: false, message: 'Supplier not found', data: null });
        }
        res.status(200).json({ status: true, message: 'Supplier', data: doc });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.updateSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, email, address, balance } = req.body;
        
        const updatedDoc = await Supplier.findOneAndUpdate(
            { _id: id, customerId: req.customerId },
            { name, phone, email, address, balance },
            { new: true }
        );
        
        if (!updatedDoc) {
            return res.status(404).json({ status: false, message: 'Supplier not found', data: null });
        }
        
        res.status(200).json({ status: true, message: 'Supplier updated', data: updatedDoc });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ status: false, message: 'Supplier already exists', data: null });
        }
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.deleteSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await Supplier.findOneAndDelete({ _id: id, customerId: req.customerId });
        if (!doc) {
            return res.status(404).json({ status: false, message: 'Supplier not found', data: null });
        }
        res.status(200).json({ status: true, message: 'Supplier deleted', data: null });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

/**
 * جلب جميع الدفعات المسددة للمورد من PurchaseInvoicePayment
 * GET /api/suppliers/:id/payments
 */
exports.getSupplierPayments = async (req, res) => {
    try {
        const { id } = req.params;
        const mongoose = require('mongoose');
        const PurchaseInvoicePayment = require('../models/PurchaseInvoicePayment');

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid supplier id', data: null });
        }

        const supplier = await Supplier.findOne({ _id: id, customerId: req.customerId }).lean();
        if (!supplier) {
            return res.status(404).json({ status: false, message: 'المورد غير موجود', data: null });
        }

        const payments = await PurchaseInvoicePayment.find({
            supplierId: id,
            customerId: req.customerId,
            status: 'active'
        })
            .populate('invoiceId', 'invoiceNumber grandTotal paidAmount status')
            .populate('createdBy', 'username name')
            .sort({ date: -1 })
            .lean();

        return res.status(200).json({
            status: true,
            message: 'Supplier payments',
            data: payments
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

