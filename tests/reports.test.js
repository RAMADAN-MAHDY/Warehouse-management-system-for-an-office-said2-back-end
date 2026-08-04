const request = require('supertest');
const app = require('../api/server');
const dbHandler = require('./db-handler');
const Client = require('../models/Client');
const Supplier = require('../models/Supplier');
const Item = require('../models/Item');
const SaleInvoice = require('../models/SaleInvoice');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const User = require('../models/User');

beforeAll(async () => await dbHandler.connect(), 30000);
afterEach(async () => await dbHandler.clearDatabase());
afterAll(async () => await dbHandler.closeDatabase());

async function getAuthToken() {
    await request(app)
        .post('/api/auth/register')
        .send({
            username: 'testuser',
            password: 'password123',
            companyName: 'Test Company'
        });

    const res = await request(app)
        .post('/api/auth/login')
        .send({
            username: 'testuser',
            password: 'password123'
        });
    return res.body.data.token;
}

describe('Reports API', () => {
    it('should get summary report', async () => {
        const token = await getAuthToken();
        const res = await request(app)
            .get('/api/reports/summary')
            .set('Authorization', `Bearer ${token}`);
        
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toHaveProperty('financials');
        expect(res.body.data).toHaveProperty('inventory');
    });

    it('should get inventory report', async () => {
        const token = await getAuthToken();
        const res = await request(app)
            .get('/api/reports/inventory')
            .set('Authorization', `Bearer ${token}`);
        
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toHaveProperty('summary');
        expect(res.body.data).toHaveProperty('items');
    });

    it('should get ai overview report', async () => {
        const token = await getAuthToken();
        const user = await User.findOne({ username: 'testuser' }).lean();
        const customerId = user.customerId;

        const client = await Client.create({
            customerId,
            code: 'CLI-0001',
            name: 'عميل اختبار',
            phone: '01000000000',
            balance: 1500,
            isActive: true
        });

        const supplier = await Supplier.create({
            customerId,
            name: 'مورد اختبار',
            phone: '02000000000',
            balance: 2200
        });

        const item = await Item.create({
            customerId,
            modelNumber: 'ITEM-001',
            name: 'صنف شراء',
            quantity: 10,
            price: 55,
            costPrice: 40,
            minQuantity: 2
        });

        await SaleInvoice.create({
            customerId,
            modelNumber: 'MDL-1',
            name: 'صنف تجريبي',
            quantity: 2,
            price: 100,
            costPrice: 60,
            totalCost: 120,
            total: 200,
            paidAmount: 50,
            paymentStatus: 'partial',
            clientName: client.name,
            clientId: client._id,
            invoiceGroupId: 'SALE-GRP-001'
        });

        await PurchaseInvoice.create({
            customerId,
            invoiceNumber: 'PUR-001',
            supplierId: supplier._id,
            items: [{
                itemId: item._id,
                qty: 3,
                unitCost: 40,
                lineTotal: 120
            }],
            subTotal: 120,
            tax: 0,
            discount: 0,
            grandTotal: 120,
            paidAmount: 20,
            paymentStatus: 'partial',
            status: 'posted'
        });

        const res = await request(app)
            .get('/api/reports/ai-overview')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toHaveProperty('counts');
        expect(res.body.data).toHaveProperty('financials');
        expect(res.body.data.counts.activeClients).toBe(1);
        expect(res.body.data.counts.suppliers).toBe(1);
        expect(res.body.data.topClientDebts[0].name).toBe('عميل اختبار');
        expect(res.body.data.topSupplierDebts[0].name).toBe('مورد اختبار');
        expect(res.body.data.recentSalesInvoices[0].invoiceNumber).toBe('SALE-GRP-001');
        expect(res.body.data.recentPurchaseInvoices[0].invoiceNumber).toBe('PUR-001');
    });
});
