const Return = require('../models/Return');
const SaleInvoice = require('../models/SaleInvoice');
const Item = require('../models/Item');
const StockMovement = require('../models/StockMovement');
const AuditLog = require('../models/AuditLog');
const mongoose = require('mongoose');

/**
 * @desc    Create a new return from a sale invoice
 * @route   POST /api/returns
 * @access  Private (Admin/Editor)
 */
exports.addReturn = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { saleInvoiceId, quantity, reason } = req.body;

        // 1. Find the sale invoice
        const sale = await SaleInvoice.findOne({ _id: saleInvoiceId, customerId: req.customerId }).session(session);
        if (!sale) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'فاتورة المبيعات غير موجودة' });
        }

        // 2. Validate quantity (cannot return more than sold)
        if (quantity > sale.quantity) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: 'الكمية المرتجعة أكبر من الكمية المباعة' });
        }

        // 3. Find the item
        const item = await Item.findOne({ modelNumber: sale.modelNumber, customerId: req.customerId }).session(session);
        if (!item) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'المنتج المرتبط بالفاتورة غير موجود في المخزن' });
        }

        // 4. Create the Return record
        const refundAmount = quantity * sale.price;
        const returnRecord = await Return.create([
            {
                customerId: req.customerId,
                saleInvoiceId: sale._id,
                itemId: item._id,
                modelNumber: sale.modelNumber,
                name: sale.name,
                quantity,
                price: sale.price,
                costPrice: sale.costPrice,
                total: refundAmount,
                reason,
                sellerName: sale.sellerName,
                date: new Date()
            }
        ], { session });

        // 5. Update Item quantity
        item.quantity += Number(quantity);
        await item.save({ session });

        // 6. Record Stock Movement
        await StockMovement.create([
            {
                customerId: req.customerId,
                itemId: item._id,
                qty: Number(quantity),
                direction: 'IN',
                reason: 'RETURN',
                referenceType: 'RETURN',
                referenceId: returnRecord[0]._id,
                unitCost: sale.costPrice,
                date: new Date()
            }
        ], { session });

        // 7. Record audit log on the original sale invoice
        await AuditLog.create([
            {
                customerId: req.customerId,
                userId: req.user?._id,
                performedBy: req.user?.username || req.user?.email || 'unknown',
                action: 'return_sale_invoice',
                referenceType: 'SALE_INVOICE',
                referenceId: sale._id,
                details: {
                    returnId: returnRecord[0]._id,
                    quantity: Number(quantity),
                    refundAmount,
                    reason: reason || null,
                    item: {
                        itemId: item._id,
                        modelNumber: sale.modelNumber,
                        name: sale.name
                    }
                }
            }
        ], { session });

        // 8. Update original sale invoice quantity (optional - depends on if we want to reflect it there)
        // For now, we keep the original sale as is, but the return is a separate record.
        // If we wanted to reduce the sale quantity:
        // sale.quantity -= quantity;
        // sale.total -= refundAmount;
        // await sale.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            status: true,
            message: 'تم تسجيل المرتجع بنجاح',
            data: returnRecord[0]
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * @desc    Get all returns
 * @route   GET /api/returns
 * @access  Private
 */
exports.getReturns = async (req, res) => {
    try {
        const { page = 1, limit = 10, from, to } = req.query;
        let filter = { customerId: req.customerId };

        if (from || to) {
            const start = from ? new Date(from) : new Date('1970-01-01');
            const end = to ? new Date(to) : new Date();
            end.setHours(23, 59, 59, 999);
            filter.date = { $gte: start, $lte: end };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Return.countDocuments(filter);
        
        const returns = await Return.find(filter)
            .sort({ date: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        // Calculate total returns value
        const stats = await Return.aggregate([
            { $match: filter },
            { $group: { _id: null, totalValue: { $sum: "$total" } } }
        ]);
        const totalReturnsValue = stats[0]?.totalValue || 0;

        res.status(200).json({
            status: true,
            message: 'قائمة المرتجعات',
            data: returns,
            totalReturnsValue,
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
};

/**
 * @desc    Delete a return record (Reverts stock update)
 * @route   DELETE /api/returns/:id
 * @access  Private (Admin)
 */
exports.deleteReturn = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { id } = req.params;
        const returnRecord = await Return.findOne({ _id: id, customerId: req.customerId }).session(session);
        
        if (!returnRecord) {
            await session.abortTransaction();
            return res.status(404).json({ status: false, message: 'سجل المرتجع غير موجود' });
        }

        // Reverse stock update
        const item = await Item.findById(returnRecord.itemId).session(session);
        if (item) {
            if (item.quantity < returnRecord.quantity) {
                // Warning: removing this return will result in negative stock
                // But usually we allow it or handle it. For now, just revert.
            }
            item.quantity -= returnRecord.quantity;
            await item.save({ session });
        }

        // Remove stock movement
        await StockMovement.deleteOne({ 
            referenceId: returnRecord._id, 
            referenceType: 'RETURN' 
        }).session(session);

        await Return.deleteOne({ _id: id }).session(session);

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({ status: true, message: 'تم حذف سجل المرتجع وتحديث المخزن' });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ status: false, message: error.message });
    }
};
