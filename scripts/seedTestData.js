const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const Purchase = require('../models/Purchase');
const Subscription = require('../models/Subscription');

const seedTestData = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB.');

        // 1. Find a user
        const user = await User.findOne({ role: 'superadmin' });
        if (!user) {
            console.error('❌ No user found in database. Please register a user first.');
            process.exit(1);
        }
        const customerId = user.customerId;
        console.log(`Using customerId: ${customerId} (User: ${user.username})`);

        // 2. Ensure Subscription exists
        let subscription = await Subscription.findOne({ customerId });
        if (!subscription) {
            console.log('Creating initial subscription...');
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            subscription = await Subscription.create({
                customerId,
                planType: 'free',
                status: 'active',
                endDate,
                limits: { maxItems: 200, maxSales: 200, maxExpenses: 200 },
                usage: { items: 0, sales: 0, expenses: 0 }
            });
        }

        // 3. Create/Find a Test Item
        let item = await Item.findOne({ customerId, modelNumber: 'TEST-1000' });
        if (!item) {
            console.log('Creating test item...');
            item = await Item.create({
                customerId,
                modelNumber: 'TEST-1000',
                name: 'منتج تجريبي للضغط',
                quantity: 5000,
                price: 100,
                costPrice: 80,
                customer: 'مورد تجريبي'
            });
        }

        // 4. Generate 1000 Purchases
        console.log('Generating 1000 purchases...');
        const purchases = [];
        for (let i = 1; i <= 1000; i++) {
            purchases.push({
                customerId,
                description: `شراء تجريبي رقم ${i}`,
                amount: 80 * 10,
                date: new Date(Date.now() - (i * 1000 * 60)), // Different times
                type: 'purchase',
                itemId: item._id,
                modelNumber: item.modelNumber,
                name: item.name,
                quantity: 10,
                price: 80,
                supplier: 'مورد تجريبي'
            });
        }
        await Purchase.insertMany(purchases);
        console.log('✅ 1000 purchases created.');

        // 5. Generate 1000 Sales
        console.log('Generating 1000 sales...');
        const sales = [];
        for (let i = 1; i <= 1000; i++) {
            sales.push({
                customerId,
                modelNumber: item.modelNumber,
                name: item.name,
                quantity: 1,
                price: 150,
                costPrice: 80,
                total: 150,
                sellerName: `عميل تجريبي ${i}`,
                createdAt: new Date(Date.now() - (i * 1000 * 60))
            });
        }
        await SaleInvoice.insertMany(sales);
        console.log('✅ 1000 sales created.');

        // 6. Update Subscription usage
        console.log('Updating subscription usage...');
        const salesCount = await SaleInvoice.countDocuments({ customerId });
        const purchasesCount = await Purchase.countDocuments({ customerId });
        const itemsCount = await Item.countDocuments({ customerId });

        subscription.usage.sales = salesCount + purchasesCount;
        subscription.usage.items = itemsCount;
        await subscription.save();
        console.log(`✅ Subscription usage updated: Sales/Purchases: ${subscription.usage.sales}, Items: ${subscription.usage.items}`);

        console.log('\n🚀 Done! 1000 purchases and 1000 sales added successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding test data:', error);
        process.exit(1);
    }
};

seedTestData();
