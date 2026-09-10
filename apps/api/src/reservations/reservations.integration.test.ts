import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus, ReservationStatus } from '@equipment-ledger/shared';
import { ReservationsModule } from './reservations.module';
import { MovementsModule } from '../movements/movements.module';
import { MovementsService } from '../movements/movements.service';
import { ReservationsService } from './reservations.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';

describe('ReservationsService.reserve', () => {
  let service: ReservationsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let reservationModel: Model<Reservation>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Reservation.name, schema: ReservationSchema },
          { name: AssetLock.name, schema: AssetLockSchema },
        ]),
        ReservationsModule,
      ],
    }).compile();

    service = moduleRef.get(ReservationsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), reservationModel.deleteMany({})]);
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
  });

  it('creates a reservation for a future window', async () => {
    const result = await service.reserve({
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      startAt: '2027-01-10T09:00:00Z',
      endAt: '2027-01-10T17:00:00Z',
      idempotencyKey: 'res-1',
    });
    expect(result.status).toBe('ACTIVE');
  });

  it('rejects a reservation overlapping an existing one, naming the conflicting window', async () => {
    await service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T09:00:00Z', endAt: '2027-01-10T17:00:00Z', idempotencyKey: 'res-2' });
    await expect(
      service.reserve({ assetId: 'DRILL-001', workerId: 'worker-2', startAt: '2027-01-10T12:00:00Z', endAt: '2027-01-10T20:00:00Z', idempotencyKey: 'res-3' }),
    ).rejects.toThrow(/Overlaps an existing reservation from 2027-01-10T09:00:00.000Z to 2027-01-10T17:00:00.000Z/);
  });

  it('carries the conflicting window on the overlap error as machine-readable data', async () => {
    await service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T09:00:00Z', endAt: '2027-01-10T17:00:00Z', idempotencyKey: 'res-9' });
    const error = await service
      .reserve({ assetId: 'DRILL-001', workerId: 'worker-2', startAt: '2027-01-10T12:00:00Z', endAt: '2027-01-10T20:00:00Z', idempotencyKey: 'res-10' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    // The client renders the window in the viewer's own timezone, so it needs the raw
    // instants rather than the ISO string baked into `message`.
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'RESERVATION_OVERLAP',
      conflict: { startAt: '2027-01-10T09:00:00.000Z', endAt: '2027-01-10T17:00:00.000Z' },
    });
  });

  it('allows two adjacent (touching, non-overlapping) reservations', async () => {
    await service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T09:00:00Z', endAt: '2027-01-10T17:00:00Z', idempotencyKey: 'res-4' });
    const second = await service.reserve({
      assetId: 'DRILL-001',
      workerId: 'worker-2',
      startAt: '2027-01-10T17:00:00Z',
      endAt: '2027-01-10T20:00:00Z',
      idempotencyKey: 'res-5',
    });
    expect(second.status).toBe('ACTIVE');
  });

  it('rejects reserving an out-of-service asset', async () => {
    await assetModel.updateOne({ _id: 'DRILL-001' }, { $set: { status: AssetStatus.OUT_OF_SERVICE } });
    await expect(
      service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T09:00:00Z', endAt: '2027-01-10T17:00:00Z', idempotencyKey: 'res-6' }),
    ).rejects.toThrow(/out of service/);
  });

  it('rejects endAt <= startAt before touching the database', async () => {
    await expect(
      service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T17:00:00Z', endAt: '2027-01-10T09:00:00Z', idempotencyKey: 'res-7' }),
    ).rejects.toThrow(/endAt must be after startAt/);
  });

  it('rejects a startAt in the past before touching the database', async () => {
    await expect(
      service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2020-01-10T17:00:00Z', endAt: '2020-01-10T20:00:00Z', idempotencyKey: 'res-8' }),
    ).rejects.toThrow(/startAt cannot be in the past/);
  });
});

describe('ReservationsService.cancel', () => {
  let service: ReservationsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let reservationModel: Model<Reservation>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Reservation.name, schema: ReservationSchema },
          { name: AssetLock.name, schema: AssetLockSchema },
        ]),
        ReservationsModule,
      ],
    }).compile();

    service = moduleRef.get(ReservationsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), reservationModel.deleteMany({})]);
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
  });

  const reserve = (idempotencyKey: string) =>
    service.reserve({
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      startAt: '2027-03-10T09:00:00Z',
      endAt: '2027-03-10T17:00:00Z',
      idempotencyKey,
    });

  it('marks an active reservation cancelled and records the reason, without deleting it', async () => {
    const reservation = await reserve('cancel-1');

    const cancelled = await service.cancel(reservation._id, { reason: 'Job postponed' });

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('Job postponed');
    // The row survives: this ledger corrects, it does not erase.
    expect(await reservationModel.countDocuments({ _id: reservation._id })).toBe(1);
  });

  it('cancels without a reason', async () => {
    const reservation = await reserve('cancel-2');
    const cancelled = await service.cancel(reservation._id, {});
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBeNull();
  });

  it('frees the window so the same slot can be reserved again', async () => {
    const reservation = await reserve('cancel-3');
    await service.cancel(reservation._id, {});

    const replacement = await service.reserve({
      assetId: 'DRILL-001',
      workerId: 'worker-2',
      startAt: '2027-03-10T09:00:00Z',
      endAt: '2027-03-10T17:00:00Z',
      idempotencyKey: 'cancel-3-replacement',
    });

    expect(replacement.status).toBe('ACTIVE');
  });

  it('rejects cancelling a reservation that is already cancelled', async () => {
    const reservation = await reserve('cancel-4');
    await service.cancel(reservation._id, {});
    await expect(service.cancel(reservation._id, {})).rejects.toThrow(/not active/i);
  });

  it('rejects cancelling an unknown reservation', async () => {
    await expect(service.cancel('64b7f9c2f1a2b3c4d5e6f7a8', {})).rejects.toThrow(/not found/i);
  });

  it('rejects a malformed reservation id without crashing on the cast', async () => {
    await expect(service.cancel('not-an-object-id', {})).rejects.toThrow(/not found/i);
  });
});

// Reserving now has to consider whether the asset is already out and when it is due back,
// which needs the movements service alongside the reservations one.
describe('ReservationsService.reserve against open loans', () => {
  let service: ReservationsService;
  let movementsService: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
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
          { name: AssetLock.name, schema: AssetLockSchema },
        ]),
        MovementsModule,
        ReservationsModule,
      ],
    }).compile();

    service = moduleRef.get(ReservationsService);
    movementsService = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), reservationModel.deleteMany({}), workerModel.deleteMany({})]);
    await Promise.all([
      workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] }),
      workerModel.create({ _id: 'worker-2', name: 'Ben Cole', certifications: [] }),
    ]);
  });

describe('against an open loan', () => {
  const hours = (n: number) => n * 60 * 60 * 1000;

  it('refuses a window that starts before the asset is due back', async () => {
    await assetModel.create({ _id: 'LOAN-001', kind: 'drill', requiresCertification: null });
    const dueAt = new Date(Date.now() + hours(6));
    await movementsService.issue({
      assetId: 'LOAN-001',
      workerId: 'worker-1',
      dueAt: dueAt.toISOString(),
      idempotencyKey: 'loan-issue-1',
    });

    await expect(
      service.reserve({
        assetId: 'LOAN-001',
        workerId: 'worker-2',
        startAt: new Date(Date.now() + hours(2)).toISOString(),
        endAt: new Date(Date.now() + hours(8)).toISOString(),
        idempotencyKey: 'loan-res-1',
      }),
    ).rejects.toThrow(new RegExp(dueAt.toISOString()));
  });

  it('allows a window that starts once the asset is due back', async () => {
    await assetModel.create({ _id: 'LOAN-002', kind: 'drill', requiresCertification: null });
    const dueAt = new Date(Date.now() + hours(6));
    await movementsService.issue({
      assetId: 'LOAN-002',
      workerId: 'worker-1',
      dueAt: dueAt.toISOString(),
      idempotencyKey: 'loan-issue-2',
    });

    const reservation = await service.reserve({
      assetId: 'LOAN-002',
      workerId: 'worker-2',
      startAt: dueAt.toISOString(),
      endAt: new Date(dueAt.getTime() + hours(2)).toISOString(),
      idempotencyKey: 'loan-res-2',
    });
    expect(reservation.status).toBe(ReservationStatus.ACTIVE);
  });

  it('still allows booking an asset that is already overdue, since every window starts after its lapsed due time', async () => {
    await assetModel.create({ _id: 'LOAN-003', kind: 'drill', requiresCertification: null });
    await movementsService.issue({
      assetId: 'LOAN-003',
      workerId: 'worker-1',
      occurredAt: new Date(Date.now() - hours(9)).toISOString(),
      dueAt: new Date(Date.now() - hours(1)).toISOString(),
      idempotencyKey: 'loan-issue-3',
    });

    const reservation = await service.reserve({
      assetId: 'LOAN-003',
      workerId: 'worker-2',
      startAt: new Date(Date.now() + hours(1)).toISOString(),
      endAt: new Date(Date.now() + hours(3)).toISOString(),
      idempotencyKey: 'loan-res-3',
    });
    expect(reservation.status).toBe(ReservationStatus.ACTIVE);
  });
});
});
