const mongoose = require('mongoose');
const Client = require('../models/Client');
const SaleInvoice = require('../models/SaleInvoice');

const normalizeName = (value) => {
    const str = String(value || '').trim();
    if (!str) return '';
    return str.replace(/\s+/g, ' ').toLowerCase();
};

exports.listClients = async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', includeInactive = 'false' } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

        const filter = { customerId: req.customerId };
        if (includeInactive !== 'true') {
            filter.isActive = true;
        }
        if (search) {
            const q = normalizeName(search);
            filter.nameNormalized = { $regex: q, $options: 'i' };
        }

        const [data, total] = await Promise.all([
            Client.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            Client.countDocuments(filter)
        ]);

        return res.status(200).json({
            status: true,
            message: 'Clients',
            data,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getClient = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid client id', data: null });
        }

        const doc = await Client.findOne({ _id: id, customerId: req.customerId }).lean();
        if (!doc) {
            return res.status(404).json({ status: false, message: 'العميل غير موجود', data: null });
        }

        return res.status(200).json({ status: true, message: 'Client', data: doc });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.createClient = async (req, res) => {
    try {
        const { name, phone, email, address } = req.body;

        // Auto-generate client code: CLI-0001, CLI-0002, etc.
        const count = await Client.countDocuments({ customerId: req.customerId });
        const nextCodeNumber = count + 1;
        const code = `CLI-${String(nextCodeNumber).padStart(4, '0')}`;

        const doc = await Client.create({
            customerId: req.customerId,
            code,
            name,
            phone,
            email,
            address,
            isActive: true
        });

        return res.status(201).json({ status: true, message: 'تم إضافة العميل بنجاح', data: doc });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ status: false, message: 'هذا العميل أو الكود موجود بالفعل', data: null });
        }
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.updateClient = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid client id', data: null });
        }

        const doc = await Client.findOne({ _id: id, customerId: req.customerId });
        if (!doc) {
            return res.status(404).json({ status: false, message: 'العميل غير موجود', data: null });
        }

        const { name, phone, email, address, isActive } = req.body;
        if (name !== undefined) doc.name = name;
        if (phone !== undefined) doc.phone = phone;
        if (email !== undefined) doc.email = email;
        if (address !== undefined) doc.address = address;
        if (isActive !== undefined) doc.isActive = isActive;
        if (doc.isActive) doc.deletedAt = undefined;

        await doc.save();

        return res.status(200).json({ status: true, message: 'تم تحديث بيانات العميل بنجاح', data: doc });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ status: false, message: 'اسم العميل مستخدم بالفعل', data: null });
        }
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.deleteClient = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid client id', data: null });
        }

        const doc = await Client.findOne({ _id: id, customerId: req.customerId });
        if (!doc) {
            return res.status(404).json({ status: false, message: 'العميل غير موجود', data: null });
        }

        doc.isActive = false;
        doc.deletedAt = new Date();
        await doc.save();

        return res.status(200).json({ status: true, message: 'تم تعطيل العميل بنجاح', data: doc });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getClientBalance = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid client id', data: null });
        }

        const client = await Client.findOne({ _id: id, customerId: req.customerId }).lean();
        if (!client) {
            return res.status(404).json({ status: false, message: 'العميل غير موجود', data: null });
        }

        // Aggregate financial summary
        const summary = await SaleInvoice.aggregate([
            { $match: { clientId: new mongoose.Types.ObjectId(id), customerId: req.customerId } },
            {
                $group: {
                    _id: null,
                    totalInvoiced: { $sum: '$total' },
                    totalPaid: { $sum: '$paidAmount' },
                    invoiceCount: { $sum: 1 }
                }
            }
        ]);

        const { page = 1, limit = 10 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

        const [invoices, totalCount] = await Promise.all([
            SaleInvoice.find({ clientId: id, customerId: req.customerId })
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            SaleInvoice.countDocuments({ clientId: id, customerId: req.customerId })
        ]);

        const fin = summary[0] || { totalInvoiced: 0, totalPaid: 0, invoiceCount: 0 };
        const totalRemaining = fin.totalInvoiced - fin.totalPaid;

        return res.status(200).json({
            status: true,
            message: 'Client balance',
            data: {
                client,
                balance: {
                    totalInvoiced: fin.totalInvoiced,
                    totalPaid: fin.totalPaid,
                    totalRemaining,
                    invoiceCount: fin.invoiceCount
                },
                invoices,
                pagination: {
                    total: totalCount,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(totalCount / limitNum)
                }
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};
