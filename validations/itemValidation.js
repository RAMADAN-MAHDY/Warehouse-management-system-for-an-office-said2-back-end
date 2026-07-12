const Joi = require('joi');

const itemCreateSchema = Joi.object({
    modelNumber: Joi.string().trim().max(1000).required().messages({
        'string.empty': 'Model number is required',
        'string.max': 'Model number cannot exceed 1000 characters'
    }),
    name: Joi.string().trim().max(50).required().messages({
        'string.empty': 'Item name is required',
        'string.max': 'Item name cannot exceed 50 characters'
    }),
    quantity: Joi.number().min(0).max(1000000).required().messages({
        'number.base': 'Quantity must be a number',
        'number.min': 'Quantity cannot be negative',
        'number.max': 'Quantity cannot exceed 1,000,000'
    }),
    price: Joi.number().min(0).max(10000000).required().messages({
        'number.base': 'Price must be a number',
        'number.min': 'Price cannot be negative',
        'number.max': 'Price cannot exceed 10,000,000'
    }),
    costPrice: Joi.number().min(0).max(10000000).optional().messages({
        'number.base': 'Cost price must be a number',
        'number.min': 'Cost price cannot be negative',
        'number.max': 'Cost price cannot exceed 10,000,000'
    }),
    minQuantity: Joi.number().min(0).max(1000000).default(5).optional().messages({
        'number.base': 'Min quantity must be a number',
        'number.min': 'Min quantity cannot be negative',
        'number.max': 'Min quantity cannot exceed 1,000,000'
    }),
    category: Joi.string().trim().max(100).allow('').optional().messages({
        'string.max': 'Category cannot exceed 100 characters'
    }),
    customer: Joi.string().trim().max(200).required().messages({
        'string.empty': 'Customer name is required',
        'string.max': 'Customer name cannot exceed 200 characters'
    })
});

const itemUpdateSchema = Joi.object({
    modelNumber: Joi.string().trim().max(1000).optional().messages({
        'string.empty': 'Model number is required',
        'string.max': 'Model number cannot exceed 1000 characters'
    }),
    name: Joi.string().trim().max(50).optional().messages({
        'string.empty': 'Item name is required',
        'string.max': 'Item name cannot exceed 50 characters'
    }),
    quantity: Joi.number().min(0).max(1000000).optional().messages({
        'number.base': 'Quantity must be a number',
        'number.min': 'Quantity cannot be negative',
        'number.max': 'Quantity cannot exceed 1,000,000'
    }),
    price: Joi.number().min(0).max(10000000).optional().messages({
        'number.base': 'Price must be a number',
        'number.min': 'Price cannot be negative',
        'number.max': 'Price cannot exceed 10,000,000'
    }),
    costPrice: Joi.number().min(0).max(10000000).optional().messages({
        'number.base': 'Cost price must be a number',
        'number.min': 'Cost price cannot be negative',
        'number.max': 'Cost price cannot exceed 10,000,000'
    }),
    minQuantity: Joi.number().min(0).max(1000000).optional().messages({
        'number.base': 'Min quantity must be a number',
        'number.min': 'Min quantity cannot be negative',
        'number.max': 'Min quantity cannot exceed 1,000,000'
    }),
    category: Joi.string().trim().max(100).allow('').optional().messages({
        'string.max': 'Category cannot exceed 100 characters'
    }),
    customer: Joi.string().trim().max(200).optional().messages({
        'string.empty': 'Customer name is required',
        'string.max': 'Customer name cannot exceed 200 characters'
    })
}).min(1);

const expenseSchema = Joi.object({
    description: Joi.string().trim().required().messages({
        'string.empty': 'Description is required'
    }),
    amount: Joi.number().min(0).required().messages({
        'number.base': 'Amount must be a number',
        'number.min': 'Amount cannot be negative'
    })
});

module.exports = {
    itemCreateSchema,
    itemUpdateSchema,
    expenseSchema
};
