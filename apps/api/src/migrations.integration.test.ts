import mongoose from 'mongoose';

// `migrations/*.js` are plain CommonJS files consumed by the migrate-mongo CLI
// (allowJs is intentionally off for this project's TS build), so we load the
// real migration module with `require` rather than an ES `import` to avoid
// TypeScript attempting (and failing) to resolve type declarations for it.
const migration = require('../migrations/20260908000000-create-indexes') as {
  up: (db: mongoose.mongo.Db) => Promise<void>;
  down: (db: mongoose.mongo.Db) => Promise<void>;
};

describe('migrate-mongo indexes', () => {
  let conn: mongoose.Connection;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
    await migration.up(conn.db!);
  });

  afterAll(async () => {
    await conn.close();
  });

  it('creates a unique index on movements.idempotencyKey', async () => {
    const indexes = await conn.collection('movements').indexes();
    const found = indexes.find((i) => i.key.idempotencyKey === 1);
    expect(found).toBeDefined();
    expect(found?.unique).toBe(true);
  });

  it('creates a compound index on movements {assetId, occurredAt}', async () => {
    const indexes = await conn.collection('movements').indexes();
    const found = indexes.find((i) => i.key.assetId === 1 && i.key.occurredAt === 1);
    expect(found).toBeDefined();
  });

  it('creates a unique index on reservations.idempotencyKey', async () => {
    const indexes = await conn.collection('reservations').indexes();
    const found = indexes.find((i) => i.key.idempotencyKey === 1);
    expect(found).toBeDefined();
    expect(found?.unique).toBe(true);
  });
});
