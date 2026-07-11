const mongoose = require('mongoose');
const InventoryAdjustment = require('../models/InventoryAdjustment');
const Item = require('../models/Item');
const StockMovement = require('../models/StockMovement');

const recalcWeightedAverageOnIn = ({ oldQty, oldAvgCost, inQty, inUnitCost }) => {
    const oldTotal = oldQty * oldAvgCost;
    const inTotal = inQty * inUnitCost;
    const newQty = oldQty + inQty;
    const newAvg = newQty > 0 ? (oldTotal + inTotal) / newQty : 0;
    return { newQty, newAvgCost: newAvg };
};

exports.createInventoryAdjustment = async (req, res) => {
    const session = await mongoose.startSession();
    const runWithTransaction = async () => {
        session.startTransaction();
        const { itemId, qtyDelta, unitCost, reason, date } = req.body;

        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ status: false, message: 'Invalid itemId', data: null });
        }

        const item = await Item.findOne({ _id: itemId, customerId: req.customerId }).session(session);
        if (!item) return res.status(404).json({ status: false, message: 'Item not found', data: null });

        const delta = Number(qtyDelta);
        const movementDirection = delta > 0 ? 'IN' : 'OUT';
        const absQty = Math.abs(delta);

        const newStock = Number(item.quantity) + delta;
        if (newStock < 0) {
            await session.abortTransaction();
            return res.status(409).json({ status: false, message: 'Stock cannot be negative', data: null });
        }

        if (delta > 0 && unitCost !== undefined) {
            const { newQty, newAvgCost } = recalcWeightedAverageOnIn({
                oldQty: Number(item.quantity),
                oldAvgCost: Number(item.costPrice),
                inQty: absQty,
                inUnitCost: Number(unitCost),
            });
            item.quantity = newQty;
            item.costPrice = newAvgCost;
        } else {
            item.quantity = newStock;
        }

        await item.save({ session });

        const doc = await InventoryAdjustment.create(
            [
                {
                    customerId: req.customerId,
                    itemId: item._id,
                    qtyDelta: delta,
                    unitCost: unitCost !== undefined ? Number(unitCost) : undefined,
                    reason: reason || '',
                    date: date ? new Date(date) : new Date(),
                    createdBy: req.user?._id,
                }
            ],
            { session }
        );

        const created = doc[0];

        await StockMovement.create(
            [
                {
                    customerId: req.customerId,
                    itemId: item._id,
                    qty: absQty,
                    direction: movementDirection,
                    reason: 'ADJUSTMENT',
                    referenceType: 'INVENTORY_ADJUSTMENT',
                    referenceId: created._id,
                    unitCost: unitCost !== undefined ? Number(unitCost) : undefined,
                    date: created.date,
                }
            ],
            { session }
        );

        await session.commitTransaction();
        return res.status(201).json({ status: true, message: 'Inventory adjusted', data: created });
    };

    try {
        return await runWithTransaction();
    } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('Transaction numbers are only allowed') || msg.includes('replica set')) {
            try {
                session.endSession();
            } catch (_) {}
            return await exports.createInventoryAdjustmentNoTx(req, res);
        }
        try {
            await session.abortTransaction();
        } catch (_) {}
        return res.status(500).json({ status: false, message: error.message, data: null });
    } finally {
        try {
            session.endSession();
        } catch (_) {}
    }
};

exports.createInventoryAdjustmentNoTx = async (req, res) => {
    try {
        const { itemId, qtyDelta, unitCost, reason, date } = req.body;

        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ status: false, message: 'Invalid itemId', data: null });
        }

        const item = await Item.findOne({ _id: itemId, customerId: req.customerId });
        if (!item) return res.status(404).json({ status: false, message: 'Item not found', data: null });

        const delta = Number(qtyDelta);
        const movementDirection = delta > 0 ? 'IN' : 'OUT';
        const absQty = Math.abs(delta);
        const newStock = Number(item.quantity) + delta;
        if (newStock < 0) {
            return res.status(409).json({ status: false, message: 'Stock cannot be negative', data: null });
        }

        if (delta > 0 && unitCost !== undefined) {
            const { newQty, newAvgCost } = recalcWeightedAverageOnIn({
                oldQty: Number(item.quantity),
                oldAvgCost: Number(item.costPrice),
                inQty: absQty,
                inUnitCost: Number(unitCost),
            });
            item.quantity = newQty;
            item.costPrice = newAvgCost;
        } else {
            item.quantity = newStock;
        }
        await item.save();

        const created = await InventoryAdjustment.create({
            customerId: req.customerId,
            itemId: item._id,
            qtyDelta: delta,
            unitCost: unitCost !== undefined ? Number(unitCost) : undefined,
            reason: reason || '',
            date: date ? new Date(date) : new Date(),
            createdBy: req.user?._id,
        });

        await StockMovement.create({
            customerId: req.customerId,
            itemId: item._id,
            qty: absQty,
            direction: movementDirection,
            reason: 'ADJUSTMENT',
            referenceType: 'INVENTORY_ADJUSTMENT',
            referenceId: created._id,
            unitCost: unitCost !== undefined ? Number(unitCost) : undefined,
            date: created.date,
        });

        return res.status(201).json({ status: true, message: 'Inventory adjusted', data: created });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message, data: null });
    }
};

exports.listInventoryAdjustments = async (req, res) => {
    try {
        const { page = 1, limit = 20, itemId } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

        const filter = { customerId: req.customerId };
        if (itemId) {
            if (!mongoose.Types.ObjectId.isValid(itemId)) {
                return res.status(400).json({ status: false, message: 'Invalid itemId', data: null });
            }
            filter.itemId = itemId;
        }

        const [data, total] = await Promise.all([
            InventoryAdjustment.find(filter)
                .populate('itemId')
                .sort({ date: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            InventoryAdjustment.countDocuments(filter)
        ]);

        res.status(200).json({
            status: true,
            message: 'Inventory adjustments',
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
