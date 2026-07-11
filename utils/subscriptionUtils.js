const Subscription = require('../models/Subscription');

/**
 * تحديث استهلاك الموارد في اشتراك العميل
 * @param {string} customerId - معرف العميل
 * @param {string} resource - نوع المورد (items, sales, expenses)
 * @param {number} increment - مقدار الزيادة (أو النقصان)
 */
const updateUsage = async (customerId, resource, increment = 1) => {
    try {
        const field = `usage.${resource}`;
        await Subscription.findOneAndUpdate(
            { customerId },
            { $inc: { [field]: increment } }
        );
    } catch (error) {
        console.error(`Error updating usage for ${resource}:`, error);
    }
};

module.exports = {
    updateUsage
};
