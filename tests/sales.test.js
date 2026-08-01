const request = require('supertest');
const app = require('../api/server');
const dbHandler = require('./db-handler');

beforeAll(async () => await dbHandler.connect(), 60000);
afterEach(async () => await dbHandler.clearDatabase());
afterAll(async () => await dbHandler.closeDatabase());

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthToken() {
    await request(app)
        .post('/api/auth/register')
        .send({
            username: 'salestestuser',
            password: 'password123',
            companyName: 'Sales Test Co'
        });

    const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'salestestuser', password: 'password123' });

    return res.body.data.token;
}

async function createItem(token, overrides = {}) {
    const res = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
            modelNumber: 'ITEM-001',
            name: 'Test Product',
            quantity: 100,
            price: 200,
            costPrice: 100,
            ...overrides
        });
    expect(res.statusCode).toBe(201);
    return res.body.data;
}

async function createClient(token, overrides = {}) {
    const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${token}`)
        .send({
            name: 'Ahmed Client',
            phone: '01000000001',
            ...overrides
        });
    expect(res.statusCode).toBe(201);
    return res.body.data;
}

async function getClientBalance(token, clientId) {
    const res = await request(app)
        .get(`/api/clients/${clientId}/balance`)
        .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    return Number(res.body.data.balance ?? res.body.balance ?? 0);
}

async function createSaleInvoice(token, payload) {
    const res = await request(app)
        .post('/api/sales')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
    return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Client.balance — فواتير البيع', () => {

    /**
     * 1. إنشاء فاتورة غير مدفوعة → Client.balance يزيد بمقدار total
     */
    it('1 - إنشاء فاتورة غير مدفوعة → Client.balance += total', async () => {
        const token = await getAuthToken();
        const item = await createItem(token);
        const client = await createClient(token);

        const balanceBefore = await getClientBalance(token, client._id);
        expect(balanceBefore).toBe(0);

        const saleRes = await createSaleInvoice(token, {
            modelNumber: item.modelNumber,
            name: item.name,
            quantity: 5,
            price: 200,
            paidAmount: 0,
            clientId: client._id
        });
        expect(saleRes.statusCode).toBe(201);

        const balanceAfter = await getClientBalance(token, client._id);
        // total = 5 * 200 = 1000, paidAmount = 0, remainingDebt = 1000
        expect(balanceAfter).toBe(1000);
    });

    /**
     * 2. دفعة جزئية → Client.balance ينقص بمقدار الدفعة
     */
    it('2 - دفعة جزئية → Client.balance -= amount', async () => {
        const token = await getAuthToken();
        const item = await createItem(token);
        const client = await createClient(token);

        // إنشاء فاتورة بـ total = 1000 بدون دفع
        const saleRes = await createSaleInvoice(token, {
            modelNumber: item.modelNumber,
            name: item.name,
            quantity: 5,
            price: 200,
            paidAmount: 0,
            clientId: client._id
        });
        expect(saleRes.statusCode).toBe(201);
        const saleId = saleRes.body.data._id;

        const balanceAfterCreate = await getClientBalance(token, client._id);
        expect(balanceAfterCreate).toBe(1000);

        // تسجيل دفعة جزئية 300
        const payRes = await request(app)
            .post(`/api/sales/${saleId}/payment`)
            .set('Authorization', `Bearer ${token}`)
            .send({ amount: 300, method: 'cash' });
        expect(payRes.statusCode).toBe(200);

        const balanceAfterPayment = await getClientBalance(token, client._id);
        expect(balanceAfterPayment).toBe(700); // 1000 - 300
    });

    /**
     * 3. دفعة تكمل المبلغ → Client.balance = 0
     */
    it('3 - دفعة تكمل المبلغ → Client.balance = 0', async () => {
        const token = await getAuthToken();
        const item = await createItem(token);
        const client = await createClient(token);

        const saleRes = await createSaleInvoice(token, {
            modelNumber: item.modelNumber,
            name: item.name,
            quantity: 5,
            price: 200,
            paidAmount: 0,
            clientId: client._id
        });
        expect(saleRes.statusCode).toBe(201);
        const saleId = saleRes.body.data._id;

        // دفع 600 أولاً
        await request(app)
            .post(`/api/sales/${saleId}/payment`)
            .set('Authorization', `Bearer ${token}`)
            .send({ amount: 600, method: 'cash' });

        // ثم دفع الـ 400 المتبقية
        const payRes = await request(app)
            .post(`/api/sales/${saleId}/payment`)
            .set('Authorization', `Bearer ${token}`)
            .send({ amount: 400, method: 'cash' });
        expect(payRes.statusCode).toBe(200);

        const balanceFinal = await getClientBalance(token, client._id);
        expect(balanceFinal).toBe(0); // يجب أن يكون صفراً بالظبط
    });

    /**
     * 4. تعديل فاتورة (تغيير الكمية) — نفس العميل → balance يتغير بالفرق
     */
    it('4 - تعديل فاتورة (qty) نفس العميل → balance يتغير بالفرق الصحيح', async () => {
        const token = await getAuthToken();
        const item = await createItem(token, { quantity: 100, price: 200, costPrice: 100 });
        const client = await createClient(token);

        // إنشاء فاتورة: qty=5, price=200, total=1000, paidAmount=0
        const saleRes = await createSaleInvoice(token, {
            modelNumber: item.modelNumber,
            name: item.name,
            quantity: 5,
            price: 200,
            paidAmount: 0,
            clientId: client._id
        });
        expect(saleRes.statusCode).toBe(201);
        const saleId = saleRes.body.data._id;

        const balanceAfterCreate = await getClientBalance(token, client._id);
        expect(balanceAfterCreate).toBe(1000); // oldRemainingDebt = 1000

        // تعديل الكمية إلى 8: total = 1600, paidAmount=0, newRemainingDebt=1600
        // debtDelta = 1600 - 1000 = +600
        const updateRes = await request(app)
            .put(`/api/sales/${saleId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ quantity: 8, price: 200, paidAmount: 0 });
        expect(updateRes.statusCode).toBe(200);

        const balanceAfterUpdate = await getClientBalance(token, client._id);
        expect(balanceAfterUpdate).toBe(1600);
    });

    /**
     * 5. تعديل فاتورة ونقلها من عميل لآخر
     */
    it('5 - تعديل فاتورة ونقلها لعميل آخر → رصيد القديم يرجع، الجديد يزيد', async () => {
        const token = await getAuthToken();
        const item = await createItem(token, { quantity: 100, price: 200, costPrice: 100 });
        const clientA = await createClient(token, { name: 'Client A', phone: '01000000001' });
        const clientB = await createClient(token, { name: 'Client B', phone: '01000000002' });

        // إنشاء فاتورة للعميل A: total=1000, paidAmount=0
        const saleRes = await createSaleInvoice(token, {
            modelNumber: item.modelNumber,
            name: item.name,
            quantity: 5,
            price: 200,
            paidAmount: 0,
            clientId: clientA._id
        });
        expect(saleRes.statusCode).toBe(201);
        const saleId = saleRes.body.data._id;

        const balanceA_before = await getClientBalance(token, clientA._id);
        expect(balanceA_before).toBe(1000);
        const balanceB_before = await getClientBalance(token, clientB._id);
        expect(balanceB_before).toBe(0);

        // نقل الفاتورة للعميل B (نفس الكمية والسعر)
        const updateRes = await request(app)
            .put(`/api/sales/${saleId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ quantity: 5, price: 200, paidAmount: 0, clientId: clientB._id });
        expect(updateRes.statusCode).toBe(200);

        const balanceA_after = await getClientBalance(token, clientA._id);
        const balanceB_after = await getClientBalance(token, clientB._id);

        expect(balanceA_after).toBe(0);    // أُعيد رصيد العميل القديم
        expect(balanceB_after).toBe(1000); // أُضيف للعميل الجديد
    });

    /**
     * 6. حذف فاتورة غير مدفوعة → Client.balance يرجع للقيمة الأصلية
     */
    it('6 - حذف فاتورة غير مدفوعة → Client.balance يرجع إلى الصفر', async () => {
        const token = await getAuthToken();
        const item = await createItem(token);
        const client = await createClient(token);

        // إنشاء فاتورة: total=1000, paidAmount=0
        const saleRes = await createSaleInvoice(token, {
            modelNumber: item.modelNumber,
            name: item.name,
            quantity: 5,
            price: 200,
            paidAmount: 0,
            clientId: client._id
        });
        expect(saleRes.statusCode).toBe(201);
        const saleId = saleRes.body.data._id;

        const balanceAfterCreate = await getClientBalance(token, client._id);
        expect(balanceAfterCreate).toBe(1000);

        // حذف الفاتورة
        const deleteRes = await request(app)
            .delete(`/api/sales/${saleId}`)
            .set('Authorization', `Bearer ${token}`);
        expect(deleteRes.statusCode).toBe(200);

        const balanceAfterDelete = await getClientBalance(token, client._id);
        expect(balanceAfterDelete).toBe(0); // يجب أن يرجع للصفر
    });

    /**
     * 7. بيع جماعي (group) بـ 3 أصناف بدون دفع → balance يزيد مرة واحدة بالمجموع الكلي
     */
    it('7 - بيع جماعي بـ 3 أصناف بدون دفع → Client.balance += المجموع الكلي (مرة واحدة)', async () => {
        const token = await getAuthToken();

        // إنشاء 3 منتجات مختلفة
        const item1 = await createItem(token, {
            modelNumber: 'PROD-A', name: 'Product A',
            quantity: 50, price: 100, costPrice: 50
        });
        const item2 = await createItem(token, {
            modelNumber: 'PROD-B', name: 'Product B',
            quantity: 50, price: 200, costPrice: 100
        });
        const item3 = await createItem(token, {
            modelNumber: 'PROD-C', name: 'Product C',
            quantity: 50, price: 300, costPrice: 150
        });

        const client = await createClient(token);
        const balanceBefore = await getClientBalance(token, client._id);
        expect(balanceBefore).toBe(0);

        // البيع الجماعي:
        //   PROD-A: 2 * 100 = 200
        //   PROD-B: 3 * 200 = 600
        //   PROD-C: 1 * 300 = 300
        //   المجموع = 1100, paidAmount = 0
        const groupRes = await request(app)
            .post('/api/sales/group')
            .set('Authorization', `Bearer ${token}`)
            .send({
                clientId: client._id,
                paidAmount: 0,
                items: [
                    { modelNumber: item1.modelNumber, name: item1.name, quantity: 2, price: 100 },
                    { modelNumber: item2.modelNumber, name: item2.name, quantity: 3, price: 200 },
                    { modelNumber: item3.modelNumber, name: item3.name, quantity: 1, price: 300 }
                ]
            });
        expect(groupRes.statusCode).toBe(201);

        const balanceAfter = await getClientBalance(token, client._id);

        // يجب أن يزيد الرصيد مرة واحدة فقط بالمجموع الكلي = 1100
        expect(balanceAfter).toBe(1100);
    });

});
