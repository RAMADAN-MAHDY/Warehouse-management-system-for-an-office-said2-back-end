const Joi = require('joi');

const supplierCreateSchema = Joi.object({
    name: Joi.string().trim().max(200).required().messages({
        'string.empty': 'Supplier name is required',
        'string.max': 'Supplier name cannot exceed 200 characters'
    }),
    phone: Joi.string().trim().max(50).optional().allow('').messages({
        'string.max': 'Phone cannot exceed 50 characters'
    }),
    email: Joi.string().trim().email().max(200).optional().allow('').messages({
        'string.email': 'Email must be valid',
        'string.max': 'Email cannot exceed 200 characters'
    }),
    address: Joi.string().trim().max(500).optional().allow('').messages({
        'string.max': 'Address cannot exceed 500 characters'
    })
});

const supplierUpdateSchema = Joi.object({
    name: Joi.string().trim().max(200).optional(),
    phone: Joi.string().trim().max(50).optional().allow(''),
    email: Joi.string().trim().email().max(200).optional().allow(''),
    address: Joi.string().trim().max(500).optional().allow(''),
    balance: Joi.number().min(0).optional() // Optional, in case we need to adjust balance
});

module.exports = { supplierCreateSchema, supplierUpdateSchema };
