const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const PurchaseInvoicePayment = require('../models/PurchaseInvoicePayment');
const User = require('../models/User');

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error('Database connection error:', err.message);
        process.exit(1);
    }
};

const migratePurchaseInvoicePayments = async () => {
    await connectDB();

    try {
        console.log('Starting migration for existing purchase invoice payments...');

        const invoices = await PurchaseInvoice.find({ paidAmount: { $gt: 0 } });
        console.log(`Found ${invoices.length} purchase invoices with paidAmount > 0.`);

        let migratedCount = 0;
        let skippedCount = 0;

        for (const invoice of invoices) {
            // Check if payment already exists for this invoice
            const existingPayment = await PurchaseInvoicePayment.findOne({
                invoiceId: invoice._id,
                status: 'active'
            });

            if (existingPayment) {
                skippedCount++;
                continue;
            }

            // Find a user for createdBy field
            let createdBy = invoice.createdBy;
            if (!createdBy) {
                const user = await User.findOne({ customerId: invoice.customerId, role: { $in: ['admin', 'superadmin', 'editor'] } });
                createdBy = user ? user._id : (await User.findOne({ customerId: invoice.customerId }))?._id;
            }

            if (!createdBy) {
                // Fallback to any user if none found for tenant
                const fallbackUser = await User.findOne();
                createdBy = fallbackUser ? fallbackUser._id : null;
            }

            if (!createdBy) {
                console.error(`Skipping invoice ${invoice.invoiceNumber}: No user found for createdBy`);
                skippedCount++;
                continue;
            }

            await PurchaseInvoicePayment.create({
                customerId: invoice.customerId,
                invoiceId: invoice._id,
                supplierId: invoice.supplierId,
                amount: invoice.paidAmount,
                method: 'other',
                note: 'دفعة مرحّلة من النظام القديم قبل تفعيل سجل الدفعات',
                date: invoice.date || invoice.createdAt || new Date(),
                createdBy,
                status: 'active'
            });

            migratedCount++;
        }

        console.log(`Migration complete. Migrated: ${migratedCount}, Skipped/Existing: ${skippedCount}`);
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
};

if (require.main === module) {
    migratePurchaseInvoicePayments();
}

module.exports = migratePurchaseInvoicePayments;
