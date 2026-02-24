/**
 * Middleware to validate request data against a Joi schema.
 * @param {Object} schema - The Joi schema to validate against.
 * @param {string} property - The request property to validate (body, query, params).
 */
const validate = (schema, property = 'body') => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[property], {
            abortEarly: false, // Return all errors, not just the first one
            stripUnknown: true, // Remove fields that are not in the schema
            errors: {
                wrap: {
                    label: ''
                }
            }
        });

        if (error) {
            const errorMessage = error.details.map((detail) => detail.message).join(', ');
            return res.status(400).json({
                status: false,
                message: errorMessage,
                data: null
            });
        }

        // Replace req property with the validated and stripped value
        req[property] = value;
        next();
    };
};

module.exports = validate;
