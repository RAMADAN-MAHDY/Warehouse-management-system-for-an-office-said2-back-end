const Joi = require('joi');

const profitAdjustmentSchema = Joi.object({
    amount: Joi.number().max(100000000).required().messages({
        'number.base': 'Amount must be a number',
        'number.max': 'Amount cannot exceed 100,000,000',
        'any.required': 'Amount is required'
    }),
    reason: Joi.string().trim().max(500).allow('').optional()
});

const reportQuerySchema = Joi.object({
    from: Joi.date().iso().optional(),
    to: Joi.date().iso().optional(),
    page: Joi.number().integer().min(1).max(1000).optional(),
    limit: Joi.number().integer().min(1).max(200).optional(),
    groupBy: Joi.string().max(50).optional(),
    search: Joi.string().trim().max(100).allow('').optional(),
    lowStock: Joi.string().valid('true', 'false').optional(),
    itemId: Joi.string().optional(),
    direction: Joi.string().valid('IN', 'OUT').optional(),
    reason: Joi.string().valid('PURCHASE', 'SALE', 'ADJUSTMENT', 'RETURN', 'PURCHASE_CANCEL', 'OPENING_BALANCE').optional()
});

module.exports = {
    profitAdjustmentSchema,
    reportQuerySchema
};
