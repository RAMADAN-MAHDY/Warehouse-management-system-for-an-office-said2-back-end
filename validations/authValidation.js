const Joi = require('joi');

const registerSchema = Joi.object({
    username: Joi.string().trim().min(3).max(30).required().messages({
        'string.empty': 'Username is required',
        'string.min': 'Username must be at least 3 characters',
        'string.max': 'Username cannot exceed 30 characters'
    }),
    password: Joi.string().min(6).max(120).required().messages({
        'string.empty': 'Password is required',
        'string.min': 'Password must be at least 6 characters'
    }),
    companyName: Joi.string().trim().max(100).allow('').default('').messages({
        'string.max': 'Company name cannot exceed 100 characters'
    }),
    role: Joi.string().valid('superadmin', 'admin', 'viewer' , 'editor').messages({
    })
});

const loginSchema = Joi.object({
    username: Joi.string().trim().required().messages({
        'string.empty': 'Username is required'
    }),
    password: Joi.string().required().messages({
        'string.empty': 'Password is required'
    })
});

module.exports = {
    registerSchema,
    loginSchema
};
