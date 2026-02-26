process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost:27017/test'; // Will be overridden by memory server
process.env.JWT_SECRET = 'test_secret_key';
