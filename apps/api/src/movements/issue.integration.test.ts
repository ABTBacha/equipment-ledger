import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus, MovementType, ReservationStatus } from '@equipment-ledger/shared';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('MovementsService.issue', () => {
  let service: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
  let movementModel: Model<Movement>;
  let reservationModel: Model<Reservation>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
          { name: Reservation.name, schema: ReservationSchema },
        ]),
        MovementsModule,
      ],
    }).compile();

    service = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    movementModel = moduleRef.get(getModelToken(Movement.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([
      assetModel.deleteMany({}),
      workerModel.deleteMany({}),
      movementModel.deleteMany({}),
      reservationModel.deleteMany({}),
    ]);
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
    await workerModel.create({ _id: 'worker-2', name: 'Ben Cole', certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2020-01-01') }] });
  });

  it('issues an in-store asset and returns the movement', async () => {
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
    const result = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'k1' });
    expect(result.type).toBe('ISSUE');
    const asset = await assetModel.findById('DRILL-001').lean();
    expect(asset?.status).toBe(AssetStatus.ISSUED);
    expect(asset?.currentHolderId).toBe('worker-1');
  });

  it('refuses issue when the required certification is expired, and writes no movement', async () => {
    await assetModel.create({ _id: 'GAS-001', kind: 'gas-detector', requiresCertification: 'GAS-DETECT' });
    await expect(service.issue({ assetId: 'GAS-001', workerId: 'worker-2', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'k2' })).rejects.toThrow(/expired/i);
    const count = await movementModel.countDocuments({ assetId: 'GAS-001' });
    expect(count).toBe(0);
  });

  it('rejects a second issue of the same asset with 409', async () => {
    await assetModel.create({ _id: 'DRILL-002', kind: 'drill', requiresCertification: null });
    await service.issue({ assetId: 'DRILL-002', workerId: 'worker-1', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'k3' });
    await expect(service.issue({ assetId: 'DRILL-002', workerId: 'worker-2', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'k4' })).rejects.toThrow(/not available/i);
  });

  it('replays the original result on a retried idempotencyKey instead of double-issuing', async () => {
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null });
    const first = await service.issue({ assetId: 'DRILL-003', workerId: 'worker-1', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'k5' });
    const second = await service.issue({ assetId: 'DRILL-003', workerId: 'worker-1', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'k5' });
    expect(second._id).toBe(first._id);
    const count = await movementModel.countDocuments({ assetId: 'DRILL-003' });
    expect(count).toBe(1);
  });

  it('replays the same result instead of conflicting when two simultaneous requests share the same idempotencyKey (double-click)', async () => {
    await assetModel.create({ _id: 'DRILL-004', kind: 'drill', requiresCertification: null });
    const [a, b] = await Promise.all([
      service.issue({ assetId: 'DRILL-004', workerId: 'worker-1', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'dup-key' }),
      service.issue({ assetId: 'DRILL-004', workerId: 'worker-1', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'dup-key' }),
    ]);
    expect(a._id).toBe(b._id);
    const count = await movementModel.countDocuments({ assetId: 'DRILL-004' });
    expect(count).toBe(1);
  });

  it('collects a booking held by the same worker without being told to, and marks it FULFILLED', async () => {
    await assetModel.create({ _id: 'DRILL-005', kind: 'drill', requiresCertification: null });
    const endAt = new Date(Date.now() + 4 * 3600_000);
    const reservation = await reservationModel.create({
      assetId: 'DRILL-005',
      workerId: 'worker-1',
      startAt: new Date(Date.now() - 3600_000),
      endAt,
      status: ReservationStatus.ACTIVE,
      idempotencyKey: 'reservation-k1',
    });

    const movement = await service.issue({
      assetId: 'DRILL-005',
      workerId: 'worker-1',
      dueAt: endAt.toISOString(),
      idempotencyKey: 'k6',
    });

    const updated = await reservationModel.findById(reservation._id).lean();
    expect(updated?.status).toBe(ReservationStatus.FULFILLED);
    expect(String(updated?.fulfilledByMovementId)).toBe(String(movement._id));
    expect(String(movement.reservationId)).toBe(String(reservation._id));
  });

  it('leaves a cancelled booking alone: a called-off window neither gates nor collects', async () => {
    await assetModel.create({ _id: 'DRILL-006', kind: 'drill', requiresCertification: null });
    const reservation = await reservationModel.create({
      assetId: 'DRILL-006',
      workerId: 'worker-1',
      startAt: new Date(Date.now() - 3600_000),
      endAt: new Date(Date.now() + 4 * 3600_000),
      status: ReservationStatus.CANCELLED,
      idempotencyKey: 'reservation-k2',
    });

    const movement = await service.issue({
      assetId: 'DRILL-006',
      workerId: 'worker-1',
      dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
      idempotencyKey: 'k7',
    });

    const updated = await reservationModel.findById(reservation._id).lean();
    expect(updated?.status).toBe(ReservationStatus.CANCELLED);
    expect(movement.reservationId).toBeNull();
  });
  describe('due-back time', () => {
    it('records a keeper-supplied dueAt on the issue movement', async () => {
      await assetModel.create({ _id: 'DRILL-020', kind: 'drill', requiresCertification: null });
      const movement = await service.issue({
        assetId: 'DRILL-020',
        workerId: 'worker-1',
        occurredAt: '2026-08-01T09:00:00Z',
        dueAt: '2026-08-01T17:00:00Z',
        idempotencyKey: 'due-1',
      });
      expect(new Date(movement.dueAt!).toISOString()).toBe('2026-08-01T17:00:00.000Z');
    });


    it('never puts a dueAt on a return', async () => {
      await assetModel.create({ _id: 'DRILL-022', kind: 'drill', requiresCertification: null });
      await service.issue({ assetId: 'DRILL-022', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', dueAt: '2026-08-01T17:00:00Z', idempotencyKey: 'due-3' });
      const ret = await service.return({ assetId: 'DRILL-022', workerId: 'worker-1', idempotencyKey: 'due-4' });
      expect(ret.dueAt).toBeNull();
    });

    it('pins the due-back time to the window when it collects a booking', async () => {
      await assetModel.create({ _id: 'DRILL-023', kind: 'drill', requiresCertification: null });
      const endAt = new Date(Date.now() + 4 * 3600_000);
      await reservationModel.create({
        assetId: 'DRILL-023',
        workerId: 'worker-1',
        startAt: new Date(Date.now() - 3600_000),
        endAt,
        status: ReservationStatus.ACTIVE,
        idempotencyKey: 'reservation-due',
      });

      const movement = await service.issue({
        assetId: 'DRILL-023',
        workerId: 'worker-1',
        dueAt: endAt.toISOString(),
        idempotencyKey: 'due-5',
      });
      expect(new Date(movement.dueAt!).toISOString()).toBe(endAt.toISOString());
    });

    it('refuses a due-back time that disagrees with the booking it collects', async () => {
      await assetModel.create({ _id: 'DRILL-024', kind: 'drill', requiresCertification: null });
      const endAt = new Date(Date.now() + 4 * 3600_000);
      await reservationModel.create({
        assetId: 'DRILL-024',
        workerId: 'worker-1',
        startAt: new Date(Date.now() - 3600_000),
        endAt,
        status: ReservationStatus.ACTIVE,
        idempotencyKey: 'reservation-due-2',
      });

      await expect(
        service.issue({
          assetId: 'DRILL-024',
          workerId: 'worker-1',
          dueAt: new Date(endAt.getTime() - 3600_000).toISOString(),
          idempotencyKey: 'due-6',
        }),
      ).rejects.toThrow(new RegExp(endAt.toISOString()));
    });

    it('does not collect a booking whose window has already closed, and does not pin to it', async () => {
      await assetModel.create({ _id: 'DRILL-028', kind: 'drill', requiresCertification: null });
      const reservation = await reservationModel.create({
        assetId: 'DRILL-028',
        workerId: 'worker-1',
        startAt: new Date('2026-01-01T00:00:00Z'),
        endAt: new Date('2026-01-01T01:00:00Z'),
        status: ReservationStatus.ACTIVE,
        idempotencyKey: 'reservation-lapsed',
      });

      // The worker turns up long after their window. They get an ordinary loan with a
      // due date the keeper picks; the booking stays uncollected, because it was.
      const movement = await service.issue({
        assetId: 'DRILL-028',
        workerId: 'worker-1',
        occurredAt: '2026-08-01T09:00:00Z',
        dueAt: '2026-08-01T17:00:00Z',
        idempotencyKey: 'due-lapsed-1',
      });

      expect(new Date(movement.dueAt!).toISOString()).toBe('2026-08-01T17:00:00.000Z');
      expect(movement.reservationId).toBeNull();
      expect((await reservationModel.findById(reservation._id).lean())?.status).toBe(ReservationStatus.ACTIVE);
    });
  });

  describe('reservation gating', () => {
    const hours = (n: number) => n * 60 * 60 * 1000;

    const reserveFor = (assetId: string, workerId: string, startAt: Date, endAt: Date, key: string) =>
      reservationModel.create({
        assetId,
        workerId,
        startAt,
        endAt,
        status: ReservationStatus.ACTIVE,
        idempotencyKey: key,
      });

    it('refuses to issue an asset inside a window reserved for somebody else', async () => {
      await assetModel.create({ _id: 'GATE-001', kind: 'drill', requiresCertification: null });
      const start = new Date(Date.now() + hours(1));
      await reserveFor('GATE-001', 'worker-2', start, new Date(start.getTime() + hours(4)), 'gate-res-1');

      await expect(
        service.issue({
          assetId: 'GATE-001',
          workerId: 'worker-1',
          dueAt: new Date(start.getTime() + hours(2)).toISOString(),
          idempotencyKey: 'gate-issue-1',
        }),
      ).rejects.toThrow(/worker-2/);
    });

    it('names the reserved window it refused against', async () => {
      await assetModel.create({ _id: 'GATE-002', kind: 'drill', requiresCertification: null });
      const start = new Date(Date.now() + hours(1));
      await reserveFor('GATE-002', 'worker-2', start, new Date(start.getTime() + hours(4)), 'gate-res-2');

      await expect(
        service.issue({
          assetId: 'GATE-002',
          workerId: 'worker-1',
          dueAt: new Date(start.getTime() + hours(2)).toISOString(),
          idempotencyKey: 'gate-issue-2',
        }),
      ).rejects.toThrow(new RegExp(start.toISOString()));
    });

    it('writes nothing when it refuses: the asset stays in store', async () => {
      await assetModel.create({ _id: 'GATE-003', kind: 'drill', requiresCertification: null });
      const start = new Date(Date.now() + hours(1));
      await reserveFor('GATE-003', 'worker-2', start, new Date(start.getTime() + hours(4)), 'gate-res-3');

      await expect(
        service.issue({
          assetId: 'GATE-003',
          workerId: 'worker-1',
          dueAt: new Date(start.getTime() + hours(2)).toISOString(),
          idempotencyKey: 'gate-issue-3',
        }),
      ).rejects.toThrow();

      expect((await assetModel.findById('GATE-003').lean())?.status).toBe(AssetStatus.IN_STORE);
      expect(await movementModel.countDocuments({ assetId: 'GATE-003' })).toBe(0);
    });

    it('lets a loan that is back before the window starts through', async () => {
      await assetModel.create({ _id: 'GATE-004', kind: 'drill', requiresCertification: null });
      const start = new Date(Date.now() + hours(6));
      await reserveFor('GATE-004', 'worker-2', start, new Date(start.getTime() + hours(4)), 'gate-res-4');

      const movement = await service.issue({
        assetId: 'GATE-004',
        workerId: 'worker-1',
        dueAt: new Date(start.getTime() - hours(1)).toISOString(),
        idempotencyKey: 'gate-issue-4',
      });
      expect(movement.type).toBe(MovementType.ISSUE);
    });

    it('lets a loan due back exactly as the window opens through, since adjacent is not overlapping', async () => {
      await assetModel.create({ _id: 'GATE-005', kind: 'drill', requiresCertification: null });
      const start = new Date(Date.now() + hours(6));
      await reserveFor('GATE-005', 'worker-2', start, new Date(start.getTime() + hours(4)), 'gate-res-5');

      const movement = await service.issue({
        assetId: 'GATE-005',
        workerId: 'worker-1',
        dueAt: start.toISOString(),
        idempotencyKey: 'gate-issue-5',
      });
      expect(new Date(movement.dueAt!).toISOString()).toBe(start.toISOString());
    });
  });
});
