const Joi = require('joi');

const saleSchema = Joi.object({
    modelNumber: Joi.string().trim().max(1000).required().messages({
        'string.empty': 'Model number is required',
        'string.max': 'Model number cannot exceed 1000 characters'
    }),
    name: Joi.string().trim().max(50).required().messages({
        'string.empty': 'Item name is required',
        'string.max': 'Item name cannot exceed 200 characters'
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
    sellerName: Joi.string().trim().max(50).allow('').optional(),
    total: Joi.number().min(0).max(100000000).optional()
});

const bulkDeleteSchema = Joi.object({
    ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
        'array.min': 'Please provide at least one ID for deletion'
    })
});

const updateSaleSchema = Joi.object({
    quantity: Joi.number().min(0).max(1000000).required().messages({
        'number.base': 'Quantity must be a number',
        'number.min': 'Quantity cannot be negative',
        'number.max': 'Quantity cannot exceed 1,000,000'
    }),
    price: Joi.number().min(0).max(10000000).required().messages({
        'number.base': 'Price must be a number',
        'number.min': 'Price cannot be negative',
        'number.max': 'Price cannot exceed 10,000,000'
    })
});

module.exports = {
    saleSchema,
    updateSaleSchema,
    bulkDeleteSchema
};
