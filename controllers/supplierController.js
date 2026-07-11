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
