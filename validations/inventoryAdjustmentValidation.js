const Joi = require('joi');

const inventoryAdjustmentCreateSchema = Joi.object({
    itemId: Joi.string().trim().required().messages({
        'string.empty': 'Item is required'
    }),
    qtyDelta: Joi.number().required().invalid(0).messages({
        'number.base': 'qtyDelta must be a number',
        'any.invalid': 'qtyDelta cannot be 0'
    }),
    unitCost: Joi.number().min(0).max(100000000).optional(),
    reason: Joi.string().trim().max(500).optional().allow(''),
    date: Joi.date().optional()
});

module.exports = { inventoryAdjustmentCreateSchema };
