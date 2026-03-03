const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost/test';
process.env.JWT_SECRET = 'secret';
process.env.CORS_ORIGIN = '';
const app = require('../api/server');

describe('CORS', () => {
  it('allows requests from Vercel app origin', async () => {
    const origin = 'https://warehouse-management-system-for-an-sooty.vercel.app';
    const res = await request(app).get('/api/health').set('Origin', origin);
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('responds to preflight with allowed methods', async () => {
    const origin = 'https://warehouse-management-system-for-an-sooty.vercel.app';
    const res = await request(app)
      .options('/api/health')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET');
    expect(res.statusCode).toBe(204);
    const methods = res.headers['access-control-allow-methods'];
    expect(methods).toBeDefined();
    expect(methods).toMatch(/GET/i);
    expect(methods).toMatch(/POST/i);
    expect(methods).toMatch(/PUT/i);
    expect(methods).toMatch(/DELETE/i);
  });
});
