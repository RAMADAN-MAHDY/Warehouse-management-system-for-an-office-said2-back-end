const Joi = require('joi');

const submitPaymentSchema = Joi.object({
    planRequested: Joi.string()
        .trim()
        .min(1)
        .max(50)
        .required()
        .messages({
            'string.empty': 'اسم الخطة مطلوب',
            'string.max': 'اسم الخطة يجب أن لا يتجاوز 50 حرفاً',
            'any.required': 'اسم الخطة مطلوب'
        }),

    referenceNumber: Joi.string()
        .trim()
        .min(6)
        .max(20)
        .pattern(/^[a-zA-Z0-9\-\/]+$/)
        .required()
        .messages({
            'string.empty': 'رقم العملية مطلوب',
            'string.min': 'رقم العملية يجب أن يكون على الأقل 6 أحرف',
            'string.max': 'رقم العملية يجب أن لا يتجاوز 20 حرفاً',
            'string.pattern.base': 'رقم العملية يجب أن يحتوي على أرقام وحروف إنجليزية فقط',
            'any.required': 'رقم العملية مطلوب'
        }),

    amount: Joi.number()
        .positive()
        .max(1_000_000)
        .required()
        .messages({
            'number.base': 'المبلغ يجب أن يكون رقماً',
            'number.positive': 'المبلغ يجب أن يكون أكبر من صفر',
            'number.max': 'المبلغ تجاوز الحد الأقصى المسموح به',
            'any.required': 'المبلغ مطلوب'
        })
});

module.exports = { submitPaymentSchema };
