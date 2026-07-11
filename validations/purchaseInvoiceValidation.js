const Joi = require('joi');

const purchaseInvoiceCreateSchema = Joi.object({
    invoiceNumber: Joi.string().trim().max(100).optional(),
    supplierId: Joi.string().trim().required().messages({
        'string.empty': 'Supplier is required'
    }),
    date: Joi.date().optional(),
    tax: Joi.number().min(0).max(100000000).optional().default(0),
    discount: Joi.number().min(0).max(100000000).optional().default(0),
    paidAmount: Joi.number().min(0).max(100000000).optional().default(0),
    items: Joi.array()
        .min(1)
        .items(
            Joi.object({
                itemId: Joi.string().trim().required(),
                qty: Joi.number().greater(0).max(100000000).required(),
                unitCost: Joi.number().min(0).max(100000000).required(),
            })
        )
        .required()
});

module.exports = { purchaseInvoiceCreateSchema };
