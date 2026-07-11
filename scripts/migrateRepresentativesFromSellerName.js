const mongoose = require('mongoose');
const dotenv = require('dotenv');
const SaleInvoice = require('../models/SaleInvoice');
const Representative = require('../models/Representative');

dotenv.config();

const normalizeName = (value) => {
    const str = String(value || '').trim();
    if (!str) return '';
    return str.replace(/\s+/g, ' ').toLowerCase();
};

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const migrate = async () => {
    await connectDB();

    try {
        const filter = {
            sellerName: { $exists: true, $ne: '' },
            $or: [{ representativeId: { $exists: false } }, { representativeId: null }]
        };

        const sales = await SaleInvoice.find(filter).lean();
        console.log(`Found ${sales.length} sales without representativeId and with sellerName.`);

        const groups = new Map();
        for (const s of sales) {
            const customerId = s.customerId;
            const normalized = normalizeName(s.sellerName);
            if (!customerId || !normalized) continue;
            const key = `${customerId}__${normalized}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    customerId,
                    normalized,
                    name: String(s.sellerName || '').trim().replace(/\s+/g, ' '),
                    saleIds: []
                });
            }
            groups.get(key).saleIds.push(s._id);
        }

        console.log(`Unique representative groups: ${groups.size}`);

        let createdCount = 0;
        let linkedCount = 0;

        for (const entry of groups.values()) {
            let rep = await Representative.findOne({
                customerId: entry.customerId,
                nameNormalized: entry.normalized
            });

            if (!rep) {
                try {
                    rep = await Representative.create({
                        customerId: entry.customerId,
                        name: entry.name,
                        isActive: true
                    });
                    createdCount += 1;
                } catch (e) {
                    if (e?.code === 11000) {
                        rep = await Representative.findOne({
                            customerId: entry.customerId,
                            nameNormalized: entry.normalized
                        });
                    } else {
                        throw e;
                    }
                }
            }

            if (!rep) continue;

            const result = await SaleInvoice.updateMany(
                { _id: { $in: entry.saleIds } },
                { $set: { representativeId: rep._id, sellerName: rep.name } }
            );
            linkedCount += result.modifiedCount || 0;
        }

        console.log(`Created representatives: ${createdCount}`);
        console.log(`Linked sales updated: ${linkedCount}`);

        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
