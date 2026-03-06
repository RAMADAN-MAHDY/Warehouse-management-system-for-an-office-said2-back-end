const Plan = require('../models/Plan');

const seedPlans = async () => {
    try {
        const plansToSeed = [
            {
                id: 'free',
                name: 'Free Plan',
                price: 0,
                limits: { maxItems: 200, maxSales: 200, maxExpenses: 200 },
                features: ['Up to 200 items', 'Up to 200 sales invoices', 'Basic reporting', 'Community support'],
                isPublic: true
            },
            {
                id: 'basic',
                name: 'Basic Plan',
                price: 180,
                limits: { maxItems: 200, maxSales: 200, maxExpenses: 200 },
                features: ['Up to 200 items', 'Up to 200 sales invoices', 'Advanced reporting', 'Email & chat support'],
                isPublic: true
            },
            {
                id: 'professional',
                name: 'Professional Plan',
                price: 480,
                limits: { maxItems: 1000, maxSales: 1000, maxExpenses: 1000 },
                features: ['Up to 1000 items', 'Unlimited sales invoices', 'Custom reports & analytics', 'Priority phone & email support'],
                isPublic: true
            }
        ];

        for (const planData of plansToSeed) {
            await Plan.findOneAndUpdate(
                { id: planData.id },
                planData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }
        console.log('✅ Default plans have been seeded/updated successfully.');
    } catch (error) {
        console.error('Error seeding plans:', error);
    }
};

module.exports = seedPlans;
