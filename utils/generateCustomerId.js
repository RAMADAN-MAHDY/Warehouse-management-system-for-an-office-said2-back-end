const crypto = require('crypto');

/**
 * توليد معرف عميل فريد بصيغة CUST-XXXXXXXX
 * @returns {string} customerId
 */
const generateCustomerId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'CUST-';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
        id += chars[bytes[i] % chars.length];
    }
    return id;
};

/**
 * توليد معرف فريد مع التحقق من قاعدة البيانات
 * @param {Model} UserModel - نموذج المستخدم للتحقق من التفرد
 * @returns {Promise<string>} customerId فريد
 */
const generateUniqueCustomerId = async (UserModel) => {
    let customerId;
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 10) {
        customerId = generateCustomerId();
        const found = await UserModel.findOne({ customerId });
        exists = !!found;
        attempts++;
    }

    if (exists) {
        throw new Error('Failed to generate unique Customer ID after multiple attempts');
    }

    return customerId;
};

module.exports = { generateCustomerId, generateUniqueCustomerId };
