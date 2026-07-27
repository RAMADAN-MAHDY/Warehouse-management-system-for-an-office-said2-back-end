const Joi = require('joi');

const createPaymentSchema = Joi.object({
    amount: Joi.number()
        .positive()
        .required()
        .messages({
            'number.positive': 'Amount must be greater than 0',
            'any.required': 'Amount is required'
        }),
    method: Joi.string()
        .trim()
        .valid('cash', 'bank_transfer', 'cheque', 'other')
        .optional(),
    referenceNumber: Joi.string()
        .trim()
        .max(100)
        .optional(),
    note: Joi.string()
        .trim()
        .max(500)
        .optional(),
    date: Joi.date()
        .optional()
});

module.exports = { createPaymentSchema };
