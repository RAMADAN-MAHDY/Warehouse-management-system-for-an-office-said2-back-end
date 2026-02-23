const mongoose = require('mongoose');
const User = require('../models/User');
const Item = require('../models/Item');
const Purchase = require('../models/Purchase');
const SaleInvoice = require('../models/SaleInvoice');
const Expense = require('../models/Expense');
const { generateUniqueCustomerId } = require('../utils/generateCustomerId');
const dotenv = require('dotenv');

dotenv.config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const migrateCustomerIds = async () => {
    await connectDB();

    try {
        console.log('Starting Customer ID migration...');

        // 1. تحديث المستخدمين الذين ليس لديهم customerId
        const usersWithoutCustomerId = await User.find({ customerId: { $exists: false } });
        console.log(`Found ${usersWithoutCustomerId.length} users without customerId.`);

        for (const user of usersWithoutCustomerId) {
            const newCustomerId = await generateUniqueCustomerId(User);
            user.customerId = newCustomerId;
            await user.save();
            console.log(`Updated user ${user.username} with new customerId: ${newCustomerId}`);
        }

        // 2. تحديث المنتجات التي ليس لديها customerId
        // هذه الخطوة تتطلب افتراضًا: إذا لم يكن للمنتج customerId، فسنحاول ربطه بمستخدم موجود.
        // في نظام SaaS، يجب أن يكون لكل منتج مالك. إذا لم يكن هناك مالك واضح، فهذا يعني مشكلة في البيانات.
        // هنا، سنفترض أن المنتجات بدون customerId تنتمي إلى المستخدمين الذين تم تحديثهم للتو،
        // أو يمكننا تعيينها لمستخدم افتراضي إذا كان هناك واحد.
        // لغرض هذا السكريبت، سنقوم بتحديث المنتجات التي ليس لديها customerId
        // وربطها بأول مستخدم تم تحديثه (هذا ليس الحل الأمثل ولكن لتوضيح المفهوم).
        // الحل الأفضل هو تتبع من قام بإنشاء المنتج.

        const itemsWithoutCustomerId = await Item.find({ customerId: { $exists: false } });
        console.log(`Found ${itemsWithoutCustomerId.length} items without customerId.`);

        if (itemsWithoutCustomerId.length > 0 && usersWithoutCustomerId.length > 0) {
            const defaultCustomerId = usersWithoutCustomerId[0].customerId; // استخدام أول customerId تم توليده
            for (const item of itemsWithoutCustomerId) {
                item.customerId = defaultCustomerId;
                await item.save();
                console.log(`Updated item ${item.name} with default customerId: ${defaultCustomerId}`);
            }
        } else if (itemsWithoutCustomerId.length > 0) {
            console.warn('No users were updated, cannot assign default customerId to items without customerId.');
            console.warn('Please ensure all users have a customerId before running this migration for items.');
        }

        // 3. تحديث المشتريات التي ليس لديها customerId
        const purchasesWithoutCustomerId = await Purchase.find({ customerId: { $exists: false } });
        console.log(`Found ${purchasesWithoutCustomerId.length} purchases without customerId.`);

        if (purchasesWithoutCustomerId.length > 0 && usersWithoutCustomerId.length > 0) {
            const defaultCustomerId = usersWithoutCustomerId[0].customerId;
            for (const purchase of purchasesWithoutCustomerId) {
                purchase.customerId = defaultCustomerId;
                await purchase.save();
                console.log(`Updated purchase ${purchase.description} with default customerId: ${defaultCustomerId}`);
            }
        } else if (purchasesWithoutCustomerId.length > 0) {
            console.warn('No users were updated, cannot assign default customerId to purchases without customerId.');
            console.warn('Please ensure all users have a customerId before running this migration for purchases.');
        }

        // 4. تحديث فواتير المبيعات التي ليس لديها customerId
        const salesWithoutCustomerId = await SaleInvoice.find({ customerId: { $exists: false } });
        console.log(`Found ${salesWithoutCustomerId.length} sales without customerId.`);

        if (salesWithoutCustomerId.length > 0 && usersWithoutCustomerId.length > 0) {
            const defaultCustomerId = usersWithoutCustomerId[0].customerId;
            for (const sale of salesWithoutCustomerId) {
                sale.customerId = defaultCustomerId;
                await sale.save();
                console.log(`Updated sale ${sale._id} with default customerId: ${defaultCustomerId}`);
            }
        } else if (salesWithoutCustomerId.length > 0) {
            console.warn('No users were updated, cannot assign default customerId to sales without customerId.');
            console.warn('Please ensure all users have a customerId before running this migration for sales.');
        }

        // 5. تحديث المصروفات التي ليس لديها customerId
        const expensesWithoutCustomerId = await Expense.find({ customerId: { $exists: false } });
        console.log(`Found ${expensesWithoutCustomerId.length} expenses without customerId.`);

        if (expensesWithoutCustomerId.length > 0 && usersWithoutCustomerId.length > 0) {
            const defaultCustomerId = usersWithoutCustomerId[0].customerId;
            for (const expense of expensesWithoutCustomerId) {
                expense.customerId = defaultCustomerId;
                await expense.save();
                console.log(`Updated expense ${expense.description} with default customerId: ${defaultCustomerId}`);
            }
        } else if (expensesWithoutCustomerId.length > 0) {
            console.warn('No users were updated, cannot assign default customerId to expenses without customerId.');
            console.warn('Please ensure all users have a customerId before running this migration for expenses.');
        }


        console.log('Customer ID migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Customer ID migration failed:', error);
        process.exit(1);
    }
};

migrateCustomerIds();
