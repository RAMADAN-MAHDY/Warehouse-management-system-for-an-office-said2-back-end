const Joi = require('joi');

const purchaseSchema = Joi.object({
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
    supplier: Joi.string().trim().max(200).required().messages({
        'string.empty': 'Supplier is required',
        'string.max': 'Supplier name cannot exceed 200 characters'
    }),
    date: Joi.date().optional()
});

module.exports = {
    purchaseSchema
};
