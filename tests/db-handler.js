const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');


let mongod;

module.exports.connect = async () => {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
};

module.exports.closeDatabase = async () => {
    if (mongod) {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongod.stop();
    }
};

module.exports.clearDatabase = async () => {
    if (mongod) {
        const collections = mongoose.connection.collections;
        for (const key in collections) {
            const collection = collections[key];
            await collection.deleteMany();
        }
    }
};
