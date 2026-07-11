const request = require('supertest');
const app = require('../api/server');
const dbHandler = require('./db-handler');

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

describe('Items API', () => {
    it('should add a new item', async () => {
        const token = await getAuthToken();
        const res = await request(app)
            .post('/api/items')
            .set('Authorization', `Bearer ${token}`)
            .send({
                modelNumber: 'M001',
                name: 'Test Item',
                quantity: 10,
                price: 150,
                costPrice: 100,
                customer: 'Test Customer'
            });
        
        expect(res.statusCode).toEqual(201);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toHaveProperty('name', 'Test Item');
        expect(res.body.data).toHaveProperty('costPrice', 100);
    });

    it('should update item price and costPrice with partial payloads', async () => {
        const token = await getAuthToken();

        const createRes = await request(app)
            .post('/api/items')
            .set('Authorization', `Bearer ${token}`)
            .send({
                modelNumber: 'M002',
                name: 'Test Item 2',
                quantity: 10,
                price: 150,
                costPrice: 100,
                customer: 'Test Customer'
            });

        expect(createRes.statusCode).toEqual(201);
        const itemId = createRes.body.data._id;

        const updatePriceRes = await request(app)
            .put(`/api/items/${itemId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ price: 175 });

        expect(updatePriceRes.statusCode).toEqual(200);
        expect(updatePriceRes.body.status).toBe(true);
        expect(updatePriceRes.body.data).toHaveProperty('price', 175);
        expect(updatePriceRes.body.data).toHaveProperty('costPrice', 100);

        const updateCostRes = await request(app)
            .put(`/api/items/${itemId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ costPrice: 110 });

        expect(updateCostRes.statusCode).toEqual(200);
        expect(updateCostRes.body.status).toBe(true);
        expect(updateCostRes.body.data).toHaveProperty('price', 175);
        expect(updateCostRes.body.data).toHaveProperty('costPrice', 110);
    });

    it('should create inventory adjustments (IN/OUT) and update item stock', async () => {
        const token = await getAuthToken();

        const createRes = await request(app)
            .post('/api/items')
            .set('Authorization', `Bearer ${token}`)
            .send({
                modelNumber: 'M003',
                name: 'Test Item 3',
                quantity: 100,
                price: 150,
                costPrice: 100,
                customer: 'Test Customer'
            });

        expect(createRes.statusCode).toEqual(201);
        const itemId = createRes.body.data._id;

        const inRes = await request(app)
            .post('/api/inventory-adjustments')
            .set('Authorization', `Bearer ${token}`)
            .send({
                itemId,
                qtyDelta: 50,
                unitCost: 105,
                reason: 'Stock Count Adjustment'
            });

        expect(inRes.statusCode).toEqual(201);
        expect(inRes.body.status).toBe(true);

        const outRes = await request(app)
            .post('/api/inventory-adjustments')
            .set('Authorization', `Bearer ${token}`)
            .send({
                itemId,
                qtyDelta: -20,
                reason: 'Damaged Goods'
            });

        expect(outRes.statusCode).toEqual(201);
        expect(outRes.body.status).toBe(true);

        const itemsRes = await request(app)
            .get('/api/items')
            .set('Authorization', `Bearer ${token}`);

        expect(itemsRes.statusCode).toEqual(200);
        const updated = itemsRes.body.data.find((x) => String(x._id) === String(itemId));
        expect(updated).toBeTruthy();
        expect(updated.quantity).toBe(130);

        const movementsRes = await request(app)
            .get(`/api/reports/stock-movements?itemId=${itemId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(movementsRes.statusCode).toEqual(200);
        expect(movementsRes.body.status).toBe(true);
        expect(Array.isArray(movementsRes.body.data.movements)).toBe(true);
        expect(movementsRes.body.data.movements.length).toBeGreaterThanOrEqual(2);
    });

    it('should get all items', async () => {
        const token = await getAuthToken();
        
        // Add an item first
        await request(app)
            .post('/api/items')
            .set('Authorization', `Bearer ${token}`)
            .send({
                modelNumber: 'M001',
                name: 'Test Item',
                quantity: 10,
                price: 150,
                customer: 'Test Customer'
            });

        const res = await request(app)
            .get('/api/items')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);
    });
});
