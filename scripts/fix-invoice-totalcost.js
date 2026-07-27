const connectDB = require('../config/db');
const { validateEnv } = require('../config/env');
const SaleInvoice = require('../models/SaleInvoice');

(async () => {
    try {
        validateEnv();
        await connectDB();
        console.log('Connected to DB');

        const cursor = SaleInvoice.find({}).cursor();
        let updated = 0;
        let total = 0;
        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            total++;
            const expected = (Number(doc.quantity) || 0) * (Number(doc.costPrice) || 0);
            if (doc.totalCost === undefined || doc.totalCost === null || Number(doc.totalCost) !== expected) {
                doc.totalCost = expected;
                await doc.save();
                updated++;
            }
        }

        console.log(`Processed ${total} invoices, updated ${updated} invoices.`);
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
})();
