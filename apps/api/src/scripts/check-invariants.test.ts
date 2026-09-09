import mongoose from 'mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { checkInvariants } from './check-invariants';

describe('checkInvariants', () => {
  let conn: mongoose.Connection;
  let AssetModel: mongoose.Model<Asset>;
  let WorkerModel: mongoose.Model<Worker>;
  let MovementModel: mongoose.Model<Movement>;
  let ReservationModel: mongoose.Model<Reservation>;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
    AssetModel = conn.model(Asset.name, AssetSchema);
    WorkerModel = conn.model(Worker.name, WorkerSchema);
    MovementModel = conn.model(Movement.name, MovementSchema);
    ReservationModel = conn.model(Reservation.name, ReservationSchema);
  });

  afterAll(async () => {
    await Promise.all([
      AssetModel.deleteMany({}),
      WorkerModel.deleteMany({}),
      MovementModel.deleteMany({}),
      ReservationModel.deleteMany({}),
    ]);
    await conn.close();
  });

  it('reports no violations for an internally consistent store', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    await AssetModel.create({ _id: 'CONSISTENT-1', kind: 'drill', requiresCertification: null, status: 'ISSUED', currentHolderId: 'worker-1' });
    await MovementModel.create({
      assetId: 'CONSISTENT-1',
      workerId: 'worker-1',
      type: 'ISSUE',
      occurredAt: new Date('2026-08-01T09:00:00Z'),
      recordedAt: new Date('2026-08-01T09:00:00Z'),
      idempotencyKey: 'inv-ok-1',
    });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations).toHaveLength(0);
  });

  it('reports a violation when live Asset state disagrees with the ledger replay', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    // Deliberately wrong: Asset says ISSUED to worker-2, but no movement ever recorded that.
    await AssetModel.create({ _id: 'MISMATCH-1', kind: 'drill', requiresCertification: null, status: 'ISSUED', currentHolderId: 'worker-2' });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations.some((v) => v.rule === 'replay-matches-live-state')).toBe(true);
  });

  it('reports a violation for overlapping ACTIVE reservations on the same asset', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    await AssetModel.create({ _id: 'OVERLAP-1', kind: 'drill', requiresCertification: null });
    await ReservationModel.create({ assetId: 'OVERLAP-1', workerId: 'worker-1', startAt: new Date('2027-01-01T09:00Z'), endAt: new Date('2027-01-01T17:00Z'), status: 'ACTIVE', idempotencyKey: 'inv-res-1' });
    await ReservationModel.create({ assetId: 'OVERLAP-1', workerId: 'worker-2', startAt: new Date('2027-01-01T12:00Z'), endAt: new Date('2027-01-01T20:00Z'), status: 'ACTIVE', idempotencyKey: 'inv-res-2' });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations.some((v) => v.rule === 'no-overlapping-reservations')).toBe(true);
  });

  it('reports a violation when an asset has two open ISSUE movements without an intervening RETURN', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    // Asset row is irrelevant to this rule; make it consistent with the second ISSUE so
    // only the double-open-movement rule (not replay-matches-live-state) fires.
    await AssetModel.create({ _id: 'DOUBLEISSUE-1', kind: 'drill', requiresCertification: null, status: 'ISSUED', currentHolderId: 'worker-2' });
    await MovementModel.create({
      assetId: 'DOUBLEISSUE-1',
      workerId: 'worker-1',
      type: 'ISSUE',
      occurredAt: new Date('2026-08-01T09:00:00Z'),
      recordedAt: new Date('2026-08-01T09:00:00Z'),
      idempotencyKey: 'inv-double-1',
    });
    // Deliberately missing RETURN: a second ISSUE while the first is still open.
    await MovementModel.create({
      assetId: 'DOUBLEISSUE-1',
      workerId: 'worker-2',
      type: 'ISSUE',
      occurredAt: new Date('2026-08-02T09:00:00Z'),
      recordedAt: new Date('2026-08-02T09:00:00Z'),
      idempotencyKey: 'inv-double-2',
    });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations.some((v) => v.rule === 'no-double-open-movement')).toBe(true);
  });

  it('reports a violation when correctedBy points at a movement whose correctionOf does not point back', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    await AssetModel.create({ _id: 'BADCORRECTION-1', kind: 'drill', requiresCertification: null, status: 'ISSUED', currentHolderId: 'worker-1' });

    const original = await MovementModel.create({
      assetId: 'BADCORRECTION-1',
      workerId: 'worker-1',
      type: 'ISSUE',
      occurredAt: new Date('2026-08-01T09:00:00Z'),
      recordedAt: new Date('2026-08-01T09:00:00Z'),
      idempotencyKey: 'inv-badcorr-original',
    });
    // An unrelated movement that does NOT reference `original` via correctionOf.
    const unrelated = await MovementModel.create({
      assetId: 'BADCORRECTION-1',
      workerId: 'worker-1',
      type: 'ISSUE',
      occurredAt: new Date('2026-08-02T09:00:00Z'),
      recordedAt: new Date('2026-08-02T09:00:00Z'),
      idempotencyKey: 'inv-badcorr-unrelated',
    });
    // Corrupt: original.correctedBy points at `unrelated`, but unrelated.correctionOf is
    // still null (it never actually references `original` back) -- a stale/wrong forward pointer.
    await MovementModel.updateOne({ _id: original._id }, { $set: { correctedBy: unrelated._id } });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations.some((v) => v.rule === 'correction-integrity')).toBe(true);
  });

  it('reports a violation when correctedBy points at a nonexistent movement', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    await AssetModel.create({ _id: 'DANGLINGCORRECTION-1', kind: 'drill', requiresCertification: null, status: 'ISSUED', currentHolderId: 'worker-1' });

    const original = await MovementModel.create({
      assetId: 'DANGLINGCORRECTION-1',
      workerId: 'worker-1',
      type: 'ISSUE',
      occurredAt: new Date('2026-08-01T09:00:00Z'),
      recordedAt: new Date('2026-08-01T09:00:00Z'),
      idempotencyKey: 'inv-dangling-original',
    });
    // Corrupt: correctedBy points at an id that does not correspond to any movement.
    await MovementModel.updateOne({ _id: original._id }, { $set: { correctedBy: new mongoose.Types.ObjectId() } });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations.some((v) => v.rule === 'correction-integrity')).toBe(true);
  });
});
