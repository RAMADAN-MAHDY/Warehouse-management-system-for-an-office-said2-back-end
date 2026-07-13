const mongoose = require('mongoose');

const normalizeName = (value) => {
    const str = String(value || '').trim();
    if (!str) return '';
    return str.replace(/\s+/g, ' ').toLowerCase();
};

const clientSchema = new mongoose.Schema(
    {
        customerId: {
            type: String,
            required: true,
            index: true,
        },
        code: {
            type: String,
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },
        nameNormalized: {
            type: String,
            required: true,
            index: true,
        },
        phone: { type: String, trim: true, maxlength: 50 },
        email: { type: String, trim: true, lowercase: true, maxlength: 200 },
        address: { type: String, trim: true, maxlength: 500 },
        isActive: { type: Boolean, default: true, index: true },
        deletedAt: { type: Date },
    },
    { timestamps: true }
);

clientSchema.pre('validate', function (next) {
    this.nameNormalized = normalizeName(this.name);
    next();
});

clientSchema.index({ customerId: 1, nameNormalized: 1 }, { unique: true });
clientSchema.index({ customerId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('Client', clientSchema);
