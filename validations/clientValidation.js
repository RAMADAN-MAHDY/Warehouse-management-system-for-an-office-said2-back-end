const Joi = require('joi');

const clientCreateSchema = Joi.object({
    name: Joi.string().trim().max(200).required(),
    phone: Joi.string().trim().max(50).allow('').optional(),
    email: Joi.string().trim().email().max(200).allow('').optional(),
    address: Joi.string().trim().max(500).allow('').optional(),
});

const clientUpdateSchema = Joi.object({
    name: Joi.string().trim().max(200).optional(),
    phone: Joi.string().trim().max(50).allow('').optional(),
    email: Joi.string().trim().email().max(200).allow('').optional(),
    address: Joi.string().trim().max(500).allow('').optional(),
    isActive: Joi.boolean().optional()
});

module.exports = {
    clientCreateSchema,
    clientUpdateSchema
};
