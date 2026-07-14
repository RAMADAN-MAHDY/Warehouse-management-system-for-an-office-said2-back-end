const mongoose = require('mongoose');
const Representative = require('../models/Representative');

const normalizeName = (value) => {
    const str = String(value || '').trim();
    if (!str) return '';
    return str.replace(/\s+/g, ' ').toLowerCase();
};

exports.listRepresentatives = async (req, res) => {
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
            Representative.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            Representative.countDocuments(filter)
        ]);

        return res.status(200).json({
            status: true,
            message: 'Representatives',
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

exports.getRepresentative = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid representative id', data: null });
        }

        const doc = await Representative.findOne({ _id: id, customerId: req.customerId }).lean();
        if (!doc) {
            return res.status(404).json({ status: false, message: 'المندوب غير موجود', data: null });
        }

        return res.status(200).json({ status: true, message: 'Representative', data: doc });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.createRepresentative = async (req, res) => {
    try {
        const { name, phone, address, commissionRate, hiredAt } = req.body;

        const doc = await Representative.create({
            customerId: req.customerId,
            name,
            phone,
            address,
            commissionRate: commissionRate ?? 0,
            hiredAt: hiredAt ? new Date(hiredAt) : undefined,
            isActive: true
        });

        return res.status(201).json({ status: true, message: 'تم إضافة المندوب', data: doc });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ status: false, message: 'هذا المندوب موجود بالفعل', data: null });
        }
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.updateRepresentative = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid representative id', data: null });
        }

        const doc = await Representative.findOne({ _id: id, customerId: req.customerId });
        if (!doc) {
            return res.status(404).json({ status: false, message: 'المندوب غير موجود', data: null });
        }

        const { name, phone, address, commissionRate, hiredAt, isActive } = req.body;
        if (name !== undefined) doc.name = name;
        if (phone !== undefined) doc.phone = phone;
        if (address !== undefined) doc.address = address;
        if (commissionRate !== undefined) doc.commissionRate = commissionRate;
        if (hiredAt !== undefined) doc.hiredAt = hiredAt ? new Date(hiredAt) : undefined;
        if (isActive !== undefined) doc.isActive = isActive;
        if (doc.isActive) doc.deletedAt = undefined;

        await doc.save();

        return res.status(200).json({ status: true, message: 'تم تحديث المندوب', data: doc });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ status: false, message: 'اسم المندوب مستخدم بالفعل', data: null });
        }
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.deleteRepresentative = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid representative id', data: null });
        }

        const doc = await Representative.findOne({ _id: id, customerId: req.customerId });
        if (!doc) {
            return res.status(404).json({ status: false, message: 'المندوب غير موجود', data: null });
        }

        doc.isActive = false;
        doc.deletedAt = new Date();
        await doc.save();

        return res.status(200).json({ status: true, message: 'تم تعطيل المندوب', data: doc });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getRepresentativeCommissionReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { from, to } = req.query;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: 'Invalid representative id', data: null });
        }

        const rep = await Representative.findOne({ _id: id, customerId: req.customerId }).lean();
        if (!rep) {
            return res.status(404).json({ status: false, message: 'المندوب غير موجود', data: null });
        }

        const filter = { representativeId: id, customerId: req.customerId };
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) {
                const endDate = new Date(to);
                endDate.setHours(23, 59, 59, 999);
                filter.createdAt.$lte = endDate;
            }
        }

        const SaleInvoice = mongoose.model('SaleInvoice');
        const sales = await SaleInvoice.find(filter).sort({ createdAt: -1 }).populate('clientId').lean();

        let totalSales = 0;
        let totalPaid = 0;
        let totalRemaining = 0;
        let totalCommission = 0;
        let collectedCommission = 0;

        const rate = (rep.commissionRate || 0) / 100;

        const detailedSales = sales.map(sale => {
            const comm = sale.total * rate;
            const collectedComm = sale.paidAmount * rate;
            
            totalSales += sale.total;
            totalPaid += sale.paidAmount;
            totalRemaining += (sale.total - sale.paidAmount);
            totalCommission += comm;
            collectedCommission += collectedComm;

            return {
                ...sale,
                commission: comm,
                collectedCommission: collectedComm,
                remainingAmount: sale.total - sale.paidAmount
            };
        });

        return res.status(200).json({
            status: true,
            message: 'Commission Report Fetched',
            data: {
                representative: rep,
                summary: {
                    totalSales,
                    totalPaid,
                    totalRemaining,
                    totalCommission,
                    collectedCommission,
                    pendingCommission: totalCommission - collectedCommission,
                    commissionRate: rep.commissionRate
                },
                sales: detailedSales
            }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};


