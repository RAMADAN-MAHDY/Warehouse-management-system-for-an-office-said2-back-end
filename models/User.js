const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    customerId: {
        type: String,
        unique: true,
        index: true,
        required: true, // تم إضافة هذا السطر لضمان وجود customerId لكل مستخدم
        // يُولَّد تلقائياً في authController عند التسجيل
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 30
    },
    companyName: {
        type: String,
        trim: true,
        default: ''
    },
    password: {
        type: String,
        required: true,
        select: false,
        minlength: 6,
        maxlength: 120
    },
    role: {
        type: String,
        enum: ['admin', 'editor', 'viewer'],
        default: 'admin'
    }
}, { timestamps: true });

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

module.exports = mongoose.model('User', userSchema);
