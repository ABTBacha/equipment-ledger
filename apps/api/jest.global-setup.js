const { MongoMemoryReplSet } = require('mongodb-memory-server');

module.exports = async function globalSetup() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  global.__MONGO_REPLSET__ = replSet;
  process.env.MONGO_URI = replSet.getUri();
};
