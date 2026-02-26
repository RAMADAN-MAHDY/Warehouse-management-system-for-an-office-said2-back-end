const request = require('supertest');
const app = require('../api/server');
const dbHandler = require('./db-handler');
const User = require('../models/User');

beforeAll(async () => await dbHandler.connect());
afterEach(async () => await dbHandler.clearDatabase());
afterAll(async () => await dbHandler.closeDatabase());

describe('Auth API', () => {
    it('should register a new user', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                username: 'testuser',
                password: 'password123',
                companyName: 'Test Company'
            });
        
        expect(res.statusCode).toEqual(201);
        expect(res.body.status).toBe(true);
        expect(res.body.data.user).toHaveProperty('username', 'testuser');
    });

    it('should login an existing user', async () => {
        // First register
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

        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toHaveProperty('token');
    });
});
