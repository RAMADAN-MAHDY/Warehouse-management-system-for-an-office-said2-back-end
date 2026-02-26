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
});
