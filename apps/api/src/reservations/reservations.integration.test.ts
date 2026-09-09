import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus } from '@equipment-ledger/shared';
import { ReservationsModule } from './reservations.module';
import { ReservationsService } from './reservations.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
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
