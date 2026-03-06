const request = require('supertest');
const app = require('../api/server');
const dbHandler = require('./db-handler');
const User = require('../models/User');
const Item = require('../models/Item');
const Plan = require('../models/Plan');
const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const AuditLog = require('../models/AuditLog');
const jwt = require('jsonwebtoken');

beforeAll(async () => await dbHandler.connect());
afterEach(async () => await dbHandler.clearDatabase());
afterAll(async () => await dbHandler.closeDatabase());

describe('Super Admin Module', () => {
    let adminToken;
    let testUser;

    beforeEach(async () => {
        // Create superadmin
        const admin = await User.create({
            username: 'superadmin',
            password: 'password123',
            customerId: 'ADMIN-001',
            companyName: 'System Admin',
            role: 'superadmin'
        });
        adminToken = jwt.sign({ id: admin._id }, process.env.JWT_SECRET);

        // Create test user
        testUser = await User.create({
            username: 'testuser',
            password: 'password123',
            customerId: 'CUST-001',
            companyName: 'Test Client'
        });

        // Add some data for test user
        await Item.create({
            customerId: 'CUST-001',
            name: 'Test Item',
            modelNumber: 'TM-001',
            quantity: 10,
            price: 100
        });
    });

    describe('User Management', () => {
        it('should fetch all users with subscriptions', async () => {
            const res = await request(app)
                .get('/api/superadmin/users')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.statusCode).toEqual(200);
            expect(res.body.data.length).toBeGreaterThan(0);
            expect(res.body.data[0]).toHaveProperty('subscription');
        });

        it('should ban a user', async () => {
            const res = await request(app)
                .put(`/api/superadmin/users/${testUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ isBanned: true, reason: 'Test Ban' });

            expect(res.statusCode).toEqual(200);
            expect(res.body.data.isBanned).toBe(true);

            // Verify audit log
            const log = await AuditLog.findOne({ action: 'BAN_USER' });
            expect(log).toBeTruthy();
            expect(log.details.reason).toBe('Test Ban');
        });

        it('should delete a user and all their data permanently', async () => {
            const res = await request(app)
                .delete(`/api/superadmin/users/${testUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ reason: 'Request by user' });

            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toContain('نهائياً');

            // Verify cascade delete
            const userCount = await User.countDocuments({ _id: testUser._id });
            const itemCount = await Item.countDocuments({ customerId: 'CUST-001' });
            
            expect(userCount).toBe(0);
            expect(itemCount).toBe(0);

            // Verify audit log
            const log = await AuditLog.findOne({ action: 'PERMANENT_DELETE_USER' });
            expect(log).toBeTruthy();
        });
    });

    describe('Plan Management', () => {
        it('should create a new plan', async () => {
            const res = await request(app)
                .post('/api/superadmin/plans')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    id: 'new-plan',
                    name: 'New Plan',
                    price: 999,
                    limits: { maxItems: 1000, maxSales: 1000, maxExpenses: 1000 }
                });

            expect(res.statusCode).toEqual(201);
            expect(res.body.data.id).toBe('new-plan');
        });

        it('should fetch all plans', async () => {
            await Plan.create({ 
                id: 'basic', 
                name: 'Basic', 
                price: 100, 
                limits: { maxItems: 200, maxSales: 200, maxExpenses: 200 } 
            });
            const res = await request(app)
                .get('/api/superadmin/plans')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.statusCode).toEqual(200);
            expect(res.body.data.length).toBeGreaterThan(0);
        });
    });

    describe('Transaction Management', () => {
        let testTransaction;

        beforeEach(async () => {
            testTransaction = await Transaction.create({
                customerId: 'CUST-001',
                amount: 180,
                referenceNumber: 'VOD123456',
                planRequested: 'basic',
                status: 'pending'
            });
        });

        it('should approve a transaction and activate subscription', async () => {
            const res = await request(app)
                .post(`/api/superadmin/transactions/${testTransaction._id}/approve`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ notes: 'Payment verified' });

            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toContain('بنجاح');

            const updatedT = await Transaction.findById(testTransaction._id);
            expect(updatedT.status).toBe('completed');

            const sub = await Subscription.findOne({ customerId: 'CUST-001' });
            expect(sub.status).toBe('active');
            expect(sub.planType).toBe('basic');
        });

        it('should reject a transaction with reason', async () => {
            const res = await request(app)
                .post(`/api/superadmin/transactions/${testTransaction._id}/reject`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ reason: 'Invalid reference number' });

            expect(res.statusCode).toEqual(200);
            
            const updatedT = await Transaction.findById(testTransaction._id);
            expect(updatedT.status).toBe('failed');
            expect(updatedT.notes).toContain('Invalid reference number');
        });
    });

    describe('Data Export', () => {
        it('should export users to excel', async () => {
            const res = await request(app)
                .get('/api/superadmin/users/export')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.statusCode).toEqual(200);
            expect(res.header['content-type']).toContain('spreadsheetml');
        });

        it('should export transactions to excel', async () => {
            const res = await request(app)
                .get('/api/superadmin/transactions/export')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.statusCode).toEqual(200);
            expect(res.header['content-type']).toContain('spreadsheetml');
        });
    });
});
