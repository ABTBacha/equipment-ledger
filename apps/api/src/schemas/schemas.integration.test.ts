import mongoose from 'mongoose';
import { AssetSchema, Asset } from './asset.schema';
import { WorkerSchema, Worker } from './worker.schema';
import { MovementSchema, Movement } from './movement.schema';
import { ReservationSchema, Reservation } from './reservation.schema';
import { AssetLockSchema, AssetLock } from './asset-lock.schema';
import { AssetStatus, MovementType, ReservationStatus } from '@equipment-ledger/shared';

describe('Mongoose schemas', () => {
  let conn: mongoose.Connection;
  let AssetModel: mongoose.Model<Asset>;
  let WorkerModel: mongoose.Model<Worker>;
  let MovementModel: mongoose.Model<Movement>;
  let ReservationModel: mongoose.Model<Reservation>;
  let AssetLockModel: mongoose.Model<AssetLock>;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
    AssetModel = conn.model(Asset.name, AssetSchema);
    WorkerModel = conn.model(Worker.name, WorkerSchema);
    MovementModel = conn.model(Movement.name, MovementSchema);
    ReservationModel = conn.model(Reservation.name, ReservationSchema);
    AssetLockModel = conn.model(AssetLock.name, AssetLockSchema);

    // Mongoose builds indexes (including unique indexes) asynchronously in the
    // background after a model is created. Without waiting for that to finish,
    // tests that rely on a unique-index violation can race ahead of the index
    // build and see no violation at all. Model#init() resolves once a model's
    // indexes are confirmed built, so awaiting it here makes index creation
    // synchronous-in-effect before any assertion runs.
    await Promise.all([
      AssetModel.init(),
      WorkerModel.init(),
      MovementModel.init(),
      ReservationModel.init(),
      AssetLockModel.init(),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      AssetModel.deleteMany({}),
      WorkerModel.deleteMany({}),
      MovementModel.deleteMany({}),
      ReservationModel.deleteMany({}),
      AssetLockModel.deleteMany({}),
    ]);
    await conn.close();
  });

  it('inserts and reads back an Asset with defaults', async () => {
    const asset = await AssetModel.create({ _id: 'HARN-014', kind: 'harness' });
    expect(asset.status).toBe(AssetStatus.IN_STORE);
    expect(asset.currentHolderId).toBeNull();
    expect(asset.currentMovementId).toBeNull();
  });

  it('inserts and reads back a Worker with certifications', async () => {
    const worker = await WorkerModel.create({
      _id: 'worker-ana-rios',
      name: 'Ana Rios',
      certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2027-01-01') }],
    });
    expect(worker.certifications).toHaveLength(1);
    expect(worker.certifications[0].code).toBe('GAS-DETECT');
  });

  it('inserts a Movement and enforces unique idempotencyKey', async () => {
    const now = new Date();
    await MovementModel.create({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      type: MovementType.ISSUE,
      occurredAt: now,
      recordedAt: now,
      idempotencyKey: 'dup-key-1',
    });
    await expect(
      MovementModel.create({
        assetId: 'HARN-014',
        workerId: 'worker-ana-rios',
        type: MovementType.ISSUE,
        occurredAt: now,
        recordedAt: now,
        idempotencyKey: 'dup-key-1',
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('declares correctionOf/correctedBy as real ObjectId schema paths, not Mixed', () => {
    // @nestjs/mongoose's DefinitionsFactory.isMongooseSchemaType() only recognizes
    // mongoose.Schema.Types.ObjectId (aka SchemaTypes.ObjectId) — not mongoose.Types.ObjectId
    // (the BSON value-construction class used for e.g. `new Types.ObjectId()`). Passing the
    // latter as a @Prop's `type` used to fail that check silently, falling back to a Mixed
    // path, which skips write-time casting and makes query-time casting/`populate()` unreliable.
    expect(MovementSchema.path('correctionOf').instance).toBe('ObjectId');
    expect(MovementSchema.path('correctedBy').instance).toBe('ObjectId');
  });

  it('inserts a Reservation with default status ACTIVE', async () => {
    const reservation = await ReservationModel.create({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      startAt: new Date('2026-10-01T09:00:00Z'),
      endAt: new Date('2026-10-01T17:00:00Z'),
      idempotencyKey: 'res-key-1',
    });
    expect(reservation.status).toBe(ReservationStatus.ACTIVE);
  });

  it('inserts an AssetLock keyed by assetId with default nonce 0', async () => {
    const lock = await AssetLockModel.create({ _id: 'HARN-014' });
    expect(lock.nonce).toBe(0);
  });
});
