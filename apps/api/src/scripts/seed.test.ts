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

  it('passes the invariant checker immediately after seeding', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);
    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations).toHaveLength(0);
  });
});
