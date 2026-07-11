const mongoose = require('mongoose');

const normalizeName = (value) => {
    const str = String(value || '').trim();
    if (!str) return '';
    return str.replace(/\s+/g, ' ').toLowerCase();
};

const representativeSchema = new mongoose.Schema(
    {
        customerId: {
            type: String,
            required: true,
            index: true,
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
        address: { type: String, trim: true, maxlength: 500 },
        commissionRate: { type: Number, default: 0, min: 0, max: 100 },
        isActive: { type: Boolean, default: true, index: true },
        hiredAt: { type: Date },
        deletedAt: { type: Date },
    },
    { timestamps: true }
);

representativeSchema.pre('validate', function (next) {
    this.nameNormalized = normalizeName(this.name);
    next();
});

representativeSchema.index({ customerId: 1, nameNormalized: 1 }, { unique: true });

module.exports = mongoose.model('Representative', representativeSchema);

