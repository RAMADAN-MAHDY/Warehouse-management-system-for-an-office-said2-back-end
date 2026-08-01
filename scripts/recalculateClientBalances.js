/**
 * scripts/recalculateClientBalances.js
 *
 * يصحح قيم Client.balance بناءً على البيانات الفعلية في SaleInvoice.
 * الرصيد الصحيح = مجموع (total - paidAmount) لكل فاتورة غير مدفوعة بالكامل.
 *
 * الاستخدام:
 *   node scripts/recalculateClientBalances.js           (dry-run: يطبع التقرير فقط)
 *   node scripts/recalculateClientBalances.js --apply   (يطبق التعديلات الفعلية)
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

// ─── Models ──────────────────────────────────────────────────────────────────
const Client = require('../models/Client');
const SaleInvoice = require('../models/SaleInvoice');

// ─── Config ───────────────────────────────────────────────────────────────────
const DRY_RUN = !process.argv.includes('--apply');
const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
    console.error('❌ MONGO_URI غير موجود في ملف .env');
    process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  إعادة حساب أرصدة العملاء من فواتير البيع');
    console.log(`  الوضع: ${DRY_RUN ? '🔍 dry-run (لا تعديلات)' : '✍️  apply (تعديلات فعلية)'}`);
    console.log('══════════════════════════════════════════════════');
    console.log('');

    await mongoose.connect(MONGO_URI);
    console.log('✅ متصل بقاعدة البيانات\n');

    // ── حساب الرصيد الصحيح لكل عميل (aggregate) ──
    const correctBalances = await SaleInvoice.aggregate([
        {
            $match: {
                clientId: { $exists: true, $ne: null }
            }
        },
        {
            $project: {
                clientId: 1,
                customerId: 1,
                remainingDebt: {
                    $max: [
                        0,
                        { $subtract: [{ $toDouble: '$total' }, { $toDouble: { $ifNull: ['$paidAmount', 0] } }] }
                    ]
                }
            }
        },
        {
            $group: {
                _id: { clientId: '$clientId', customerId: '$customerId' },
                correctBalance: { $sum: '$remainingDebt' }
            }
        }
    ]);

    if (correctBalances.length === 0) {
        console.log('ℹ️  لا توجد فواتير مرتبطة بعملاء.');
        await mongoose.disconnect();
        return;
    }

    // ── جلب الأرصدة الحالية ──
    const clientIds = correctBalances.map(r => r._id.clientId);
    const clients = await Client.find({ _id: { $in: clientIds } })
        .select('_id name balance customerId')
        .lean();

    const clientMap = {};
    for (const c of clients) {
        clientMap[String(c._id)] = c;
    }

    // ── بناء تقرير المقارنة ──
    let affectedCount = 0;
    let totalAbsDiff = 0;
    const updates = [];

    console.log('┌─────────────────────────────────────────────────────────────────────────┐');
    console.log('│  العميل                          │ الرصيد الحالي │ الصحيح     │ الفرق    │');
    console.log('├─────────────────────────────────────────────────────────────────────────┤');

    for (const row of correctBalances) {
        const cId = String(row._id.clientId);
        const client = clientMap[cId];
        if (!client) continue;

        const currentBalance = Number(client.balance || 0);
        const correctBalance = Number(row.correctBalance.toFixed(2));
        const diff = Number((correctBalance - currentBalance).toFixed(2));

        const name = (client.name || '').substring(0, 30).padEnd(30);
        const cur = String(currentBalance.toFixed(2)).padStart(13);
        const cor = String(correctBalance.toFixed(2)).padStart(10);
        const dif = String(diff.toFixed(2)).padStart(9);

        console.log(`│  ${name} │ ${cur} │ ${cor} │ ${dif} │`);

        if (diff !== 0) {
            affectedCount++;
            totalAbsDiff += Math.abs(diff);
            updates.push({
                clientId: cId,
                customerId: row._id.customerId,
                correctBalance,
                diff
            });
        }
    }

    console.log('└─────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log(`📊 الملخص: ${correctBalances.length} عميل تمت مراجعته، ${affectedCount} يحتاج تصحيح`);
    console.log(`   إجمالي الفرق المطلق: ${totalAbsDiff.toFixed(2)}`);
    console.log('');

    if (affectedCount === 0) {
        console.log('✅ جميع الأرصدة صحيحة، لا يوجد شيء للتصحيح.');
        await mongoose.disconnect();
        return;
    }

    if (DRY_RUN) {
        console.log('ℹ️  dry-run — لم يُطبَّق أي تعديل.');
        console.log('   لتطبيق التعديلات: node scripts/recalculateClientBalances.js --apply');
        await mongoose.disconnect();
        return;
    }

    // ── تطبيق التعديلات ──
    console.log('⚙️  جارٍ تطبيق التعديلات...');
    let successCount = 0;
    let errorCount = 0;

    for (const upd of updates) {
        try {
            await Client.updateOne(
                { _id: upd.clientId, customerId: upd.customerId },
                { $set: { balance: upd.correctBalance } }
            );
            successCount++;
            console.log(`   ✅ تم تصحيح العميل ${upd.clientId}: ${upd.correctBalance} (فرق: ${upd.diff > 0 ? '+' : ''}${upd.diff})`);
        } catch (err) {
            errorCount++;
            console.error(`   ❌ فشل تصحيح العميل ${upd.clientId}: ${err.message}`);
        }
    }

    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log(`  ✅ نجح: ${successCount}   ❌ فشل: ${errorCount}`);
    console.log('══════════════════════════════════════════════════');

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('❌ خطأ غير متوقع:', err.message);
    mongoose.disconnect().finally(() => process.exit(1));
});
