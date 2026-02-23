const SaleInvoice = require('../models/SaleInvoice');
const Item = require('../models/Item');

exports.addSaleInvoice = async (req, res) => {
    try {
        const { modelNumber, name, quantity, price, sellerName, total: frontTotal } = req.body;

        if (!modelNumber || !name || quantity == null || price == null) {
            return res.status(400).json({ status: false, message: 'يرجى تقديم جميع الحقول المطلوبة', data: null });
        }

        // البحث عن العنصر مع تطبيق عزل العميل
        const item = await Item.findOne({ modelNumber, customerId: req.customerId });

        if (!item) return res.status(404).json({ status: false, message: 'المنتج غير موجود', data: null });

        if (item.quantity < quantity) return res.status(400).json({ status: false, message: 'الكمية غير متوفرة', data: null });
        item.quantity -= quantity;

        await item.save();

        const total = frontTotal || quantity * price;

        const invoice = await SaleInvoice.create({
            customerId: req.customerId,
            modelNumber,
            name,
            quantity,
            price,
            total,
            sellerName,
            costPrice: item.costPrice || item.price
        });
        res.status(201).json({ status: true, message: 'تم إضافة فاتورة البيع', data: invoice });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.getSaleInvoices = async (req, res) => {
    try {
        const { day, month, year, from, to } = req.query;
        let filter = { customerId: req.customerId };

        if (day) {
            const start = new Date(day);
            const end = new Date(day);
            end.setDate(end.getDate() + 1);
            filter.createdAt = { $gte: start, $lt: end };
        } else if (month) {
            const [y, m] = month.split('-');
            const start = new Date(y, m - 1, 1);
            const end = new Date(y, m, 1);
            filter.createdAt = { $gte: start, $lt: end };
        } else if (year) {
            const start = new Date(year, 0, 1);
            const end = new Date(Number(year) + 1, 0, 1);
            filter.createdAt = { $gte: start, $lt: end };
        } else if (from || to) {
            const start = from ? new Date(from) : new Date('1970-01-01');
            const end = to ? new Date(to) : new Date();
            end.setDate(end.getDate() + 1);
            filter.createdAt = { $gte: start, $lt: end };
        }

        const invoices = await SaleInvoice.find(filter).sort({ createdAt: -1 }).limit(100);

        const sales = invoices.map(invoice => ({
            ...invoice.toObject(),
            customer: invoice.sellerName || 'N/A'
        }));

        res.status(200).json({
            status: true,
            message: 'فواتير البيع',
            data: sales
        });
    } catch (error) {
        res.status(500).json({
            status: false,
            message: error.message,
            data: null
        });
    }
};

exports.updateSaleInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, price } = req.body;

        // التحقق من ملكية الفاتورة قبل التعديل
        const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId });
        if (!sale) return res.status(404).json({ status: false, message: 'الفاتورة غير موجودة' });

        const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId });
        if (item) {
            item.quantity += sale.quantity;
            if (item.quantity < quantity) {
                return res.status(400).json({ status: false, message: 'الكمية غير كافية' });
            }
            item.quantity -= quantity;
            await item.save();
        }

        sale.quantity = quantity;
        sale.price = price;
        sale.total = quantity * price;
        await sale.save();

        res.json({ status: true, message: 'تم تحديث الفاتورة', data: sale });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.deleteSaleInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId });

        if (!sale) return res.status(404).json({ status: false, message: 'الفاتورة غير موجودة' });

        const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId });
        if (item) {
            item.quantity += sale.quantity;
            await item.save();
        }

        await SaleInvoice.findByIdAndDelete(id);
        res.json({ status: true, message: 'تم حذف الفاتورة' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.bulkDeleteSaleInvoices = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ status: false, message: 'الرجاء تقديم قائمة بمعرفات الفواتير للحذف.' });
        }

        for (const id of ids) {
            const sale = await SaleInvoice.findOne({ _id: id, customerId: req.customerId });
            if (sale) {
                const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId });
                if (item) {
                    item.quantity += sale.quantity;
                    await item.save();
                }
                await SaleInvoice.findByIdAndDelete(id);
            }
        }

        res.json({ status: true, message: 'تم حذف الفواتير المحددة بنجاح!' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
