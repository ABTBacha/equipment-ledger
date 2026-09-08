module.exports = {
  mongodb: {
    url: process.env.MONGO_URI ?? 'mongodb://localhost:27017/equipment_ledger?replicaSet=rs0',
    databaseName: undefined,
    options: {},
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};
