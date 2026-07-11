const Joi = require('joi');

const representativeCreateSchema = Joi.object({
    name: Joi.string().trim().max(200).required(),
    phone: Joi.string().trim().max(50).allow('').optional(),
    address: Joi.string().trim().max(500).allow('').optional(),
    commissionRate: Joi.number().min(0).max(100).optional(),
    hiredAt: Joi.date().iso().optional()
});

const representativeUpdateSchema = Joi.object({
    name: Joi.string().trim().max(200).optional(),
    phone: Joi.string().trim().max(50).allow('').optional(),
    address: Joi.string().trim().max(500).allow('').optional(),
    commissionRate: Joi.number().min(0).max(100).optional(),
    hiredAt: Joi.date().iso().allow(null).optional(),
    isActive: Joi.boolean().optional()
});

module.exports = {
    representativeCreateSchema,
    representativeUpdateSchema
};

