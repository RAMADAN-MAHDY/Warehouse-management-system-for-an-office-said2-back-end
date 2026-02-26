const request = require('supertest');
const app = require('../api/server');
const dbHandler = require('./db-handler');

beforeAll(async () => await dbHandler.connect());
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
                customer: 'Test Customer'
            });
        
        expect(res.statusCode).toEqual(201);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toHaveProperty('name', 'Test Item');
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
