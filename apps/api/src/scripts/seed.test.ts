import mongoose from 'mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { seed } from './seed';
import { checkInvariants } from './check-invariants';

describe('seed', () => {
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
    await conn.close();
  });

  it('produces the same story on a second run (deterministic, repeat-safe)', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');

    const first = await seed(process.env.MONGO_URI!, fixedNow);
    const firstAssetCount = await AssetModel.countDocuments();
    const firstWorkerCount = await WorkerModel.countDocuments();

    const second = await seed(process.env.MONGO_URI!, fixedNow);
    const secondAssetCount = await AssetModel.countDocuments();
    const secondWorkerCount = await WorkerModel.countDocuments();

    expect(secondAssetCount).toBe(firstAssetCount);
    expect(secondWorkerCount).toBe(firstWorkerCount);
    expect(second.outOfServiceAssetId).toBe(first.outOfServiceAssetId);
    expect(second.assetCount).toBe(60);
    expect(second.workerCount).toBe(12);
  });

  it('produces the required scenario shapes: certifications, out-of-service, movements, reservations', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);

    const outOfServiceCount = await AssetModel.countDocuments({ status: 'OUT_OF_SERVICE' });
    expect(outOfServiceCount).toBeGreaterThanOrEqual(1);

    const expiredCerts = await WorkerModel.countDocuments({ 'certifications.expiresAt': { $lt: fixedNow } });
    expect(expiredCerts).toBeGreaterThanOrEqual(2);

    const openIssues = await AssetModel.countDocuments({ status: 'ISSUED' });
    expect(openIssues).toBeGreaterThanOrEqual(1);

    const correctionCount = await MovementModel.countDocuments({ correctionOf: { $ne: null } });
    expect(correctionCount).toBeGreaterThanOrEqual(1);

    const lateLogged = await MovementModel.countDocuments({ $expr: { $gt: [{ $subtract: ['$recordedAt', '$occurredAt'] }, 60 * 60 * 1000] } });
    expect(lateLogged).toBeGreaterThanOrEqual(1);

    const activeReservations = await ReservationModel.countDocuments({ status: 'ACTIVE' });
    expect(activeReservations).toBeGreaterThanOrEqual(2);
  });

  it('spreads movements across the whole window, not just its opening days', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);

    const DAY = 24 * 60 * 60 * 1000;
    const movements = await MovementModel.find({}).lean();
    const daysWithTraffic = new Set(
      movements.map((m) => Math.floor((fixedNow.getTime() - m.occurredAt.getTime()) / DAY)),
    );

    // A thirty-day window that only has traffic in its first week reads as a dead store.
    expect(daysWithTraffic.size).toBeGreaterThanOrEqual(24);
  });

  it('seeds a certification that is still valid but expires inside the window', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);

    const windowEnd = new Date(fixedNow.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringSoon = await WorkerModel.countDocuments({
      certifications: { $elemMatch: { expiresAt: { $gt: fixedNow, $lt: windowEnd } } },
    });
    expect(expiringSoon).toBeGreaterThanOrEqual(1);
  });

  it('passes the invariant checker immediately after seeding', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);
    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations).toHaveLength(0);
  });

  it('seeds at least one asset that is genuinely overdue, and outstanding ones that are not', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);

    const openIssues = await MovementModel.find({ type: 'ISSUE', dueAt: { $ne: null } }).lean();
    const assets = await AssetModel.find({}).lean();
    const openByMovementId = new Map(
      assets
        .filter((a) => a.currentMovementId !== null)
        .map((a) => [a.currentMovementId as string, a]),
    );

    const outAndDue = openIssues.filter((m) => openByMovementId.has(String(m._id)));
    const overdue = outAndDue.filter((m) => m.dueAt!.getTime() < fixedNow.getTime());
    const notYetDue = outAndDue.filter((m) => m.dueAt!.getTime() >= fixedNow.getTime());

    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(notYetDue.length).toBeGreaterThanOrEqual(1);
  });

  it('never puts a due-back time on anything but an issue', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);

    const misplaced = await MovementModel.find({ type: { $ne: 'ISSUE' }, dueAt: { $ne: null } }).lean();
    expect(misplaced).toHaveLength(0);
  });

  it('seeds a booking nobody collected and one collected but never returned', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);

    const reservations = await ReservationModel.find({}).lean();

    const uncollected = reservations.filter(
      (r) => r.status === 'ACTIVE' && r.endAt.getTime() < fixedNow.getTime(),
    );
    expect(uncollected.length).toBeGreaterThanOrEqual(1);

    const collected = reservations.filter((r) => r.status === 'FULFILLED');
    expect(collected.length).toBeGreaterThanOrEqual(2);
    for (const r of collected) {
      expect(r.fulfilledByMovementId).not.toBeNull();
    }

    // One of them is still out: its collecting issue is the asset's open movement.
    const assets = await AssetModel.find({}).lean();
    const stillOut = collected.filter((r) => {
      const asset = assets.find((a) => a._id === r.assetId);
      return asset?.currentMovementId === String(r.fulfilledByMovementId);
    });
    expect(stillOut).toHaveLength(1);
    expect(stillOut[0].endAt.getTime()).toBeLessThan(fixedNow.getTime());
  });

  it('never issues a seeded asset inside a window somebody else booked', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);

    const reservations = await ReservationModel.find({}).lean();
    const assets = await AssetModel.find({}).lean();

    for (const r of reservations) {
      const asset = assets.find((a) => a._id === r.assetId);
      if (asset?.status !== 'ISSUED') continue;
      expect(asset.currentHolderId).toBe(r.workerId);
    }
  });
});
