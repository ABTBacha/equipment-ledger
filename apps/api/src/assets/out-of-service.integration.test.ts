import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus, ReservationStatus } from '@equipment-ledger/shared';
import { AssetsModule } from './assets.module';
import { AssetsService } from './assets.service';
import { MovementsModule } from '../movements/movements.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { ReservationsService } from '../reservations/reservations.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';

describe('AssetsService out-of-service transitions', () => {
  let service: AssetsService;
  let reservationsService: ReservationsService;
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
          { name: AssetLock.name, schema: AssetLockSchema },
        ]),
        MovementsModule,
        ReservationsModule,
        AssetsModule,
      ],
    }).compile();

    service = moduleRef.get(AssetsService);
    reservationsService = moduleRef.get(ReservationsService);
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
  });

  it('cancels standing ACTIVE reservations when taking an IN_STORE asset out of service', async () => {
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
    await reservationModel.create({
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      startAt: new Date('2027-01-10T09:00:00Z'),
      endAt: new Date('2027-01-10T17:00:00Z'),
      idempotencyKey: 'res-standing-1',
    });

    await service.takeOutOfService('DRILL-001', { reason: 'Broken chuck', idempotencyKey: 'oos-1' });

    const asset = await assetModel.findById('DRILL-001').lean();
    expect(asset?.status).toBe(AssetStatus.OUT_OF_SERVICE);
    const reservation = await reservationModel.findOne({ assetId: 'DRILL-001' }).lean();
    expect(reservation?.status).toBe(ReservationStatus.CANCELLED);
    expect(reservation?.cancelReason).toMatch(/out of service/i);
  });

  it('behaves like a return when taking an ISSUED asset out of service', async () => {
    await assetModel.create({ _id: 'DRILL-002', kind: 'drill', requiresCertification: null, status: AssetStatus.ISSUED, currentHolderId: 'worker-1' });
    const [openMovement] = await movementModel.create([
      { assetId: 'DRILL-002', workerId: 'worker-1', type: 'ISSUE', occurredAt: new Date('2026-08-01T09:00:00Z'), recordedAt: new Date('2026-08-01T09:00:00Z'), idempotencyKey: 'oos-issue-2' },
    ]);
    await assetModel.updateOne({ _id: 'DRILL-002' }, { $set: { currentMovementId: String(openMovement._id) } });

    await service.takeOutOfService('DRILL-002', { occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'oos-2' });

    const asset = await assetModel.findById('DRILL-002').lean();
    expect(asset?.status).toBe(AssetStatus.OUT_OF_SERVICE);
    const movements = await movementModel.find({ assetId: 'DRILL-002', type: { $in: ['RETURN', 'OUT_OF_SERVICE'] } }).lean();
    expect(movements).toHaveLength(2);
  });

  it('rejects taking an already-out-of-service asset out of service again', async () => {
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null, status: AssetStatus.OUT_OF_SERVICE });
    await expect(service.takeOutOfService('DRILL-003', { idempotencyKey: 'oos-3' })).rejects.toThrow(/already out of service/);
  });

  it('brings an out-of-service asset back into service', async () => {
    await assetModel.create({ _id: 'DRILL-004', kind: 'drill', requiresCertification: null, status: AssetStatus.OUT_OF_SERVICE });
    await service.bringBackIntoService('DRILL-004', { idempotencyKey: 'bis-1' });
    const asset = await assetModel.findById('DRILL-004').lean();
    expect(asset?.status).toBe(AssetStatus.IN_STORE);
  });

  it('rejects bringing an already-in-store asset back into service', async () => {
    await assetModel.create({ _id: 'DRILL-005', kind: 'drill', requiresCertification: null });
    await expect(service.bringBackIntoService('DRILL-005', { idempotencyKey: 'bis-2' })).rejects.toThrow(/not currently out of service/);
  });

  it('lets a double-click (identical idempotencyKey) taking an IN_STORE asset out of service both resolve to the same movement', async () => {
    await assetModel.create({ _id: 'DRILL-006', kind: 'drill', requiresCertification: null });

    const request = { reason: 'Double click test', idempotencyKey: 'oos-double-click' };
    const [a, b] = await Promise.all([
      service.takeOutOfService('DRILL-006', request),
      service.takeOutOfService('DRILL-006', request),
    ]);

    expect(a._id).toBe(b._id);
    const count = await movementModel.countDocuments({ assetId: 'DRILL-006', type: AssetStatus.OUT_OF_SERVICE });
    expect(count).toBe(1);
    const oosCount = await movementModel.countDocuments({ assetId: 'DRILL-006', type: 'OUT_OF_SERVICE' });
    expect(oosCount).toBe(1);
    const asset = await assetModel.findById('DRILL-006').lean();
    expect(asset?.status).toBe(AssetStatus.OUT_OF_SERVICE);
  });

  it('lets a double-click (identical idempotencyKey) bringing an asset back into service both resolve to the same movement', async () => {
    await assetModel.create({ _id: 'DRILL-007', kind: 'drill', requiresCertification: null, status: AssetStatus.OUT_OF_SERVICE });

    const request = { idempotencyKey: 'bis-double-click' };
    const [a, b] = await Promise.all([
      service.bringBackIntoService('DRILL-007', request),
      service.bringBackIntoService('DRILL-007', request),
    ]);

    expect(a._id).toBe(b._id);
    const count = await movementModel.countDocuments({ assetId: 'DRILL-007', type: 'BACK_IN_SERVICE' });
    expect(count).toBe(1);
    const asset = await assetModel.findById('DRILL-007').lean();
    expect(asset?.status).toBe(AssetStatus.IN_STORE);
  });

  it('never leaves an active reservation on an asset that ends up out of service, regardless of which of a concurrent reserve()/takeOutOfService() wins', async () => {
    await assetModel.create({ _id: 'DRILL-008', kind: 'drill', requiresCertification: null });

    const [oosResult, reserveResult] = await Promise.allSettled([
      service.takeOutOfService('DRILL-008', { reason: 'Concurrent test', idempotencyKey: 'oos-race-1' }),
      reservationsService.reserve({
        assetId: 'DRILL-008',
        workerId: 'worker-1',
        startAt: '2027-05-01T09:00:00Z',
        endAt: '2027-05-01T17:00:00Z',
        idempotencyKey: 'reserve-race-1',
      }),
    ]);

    // Both may succeed independently (takeOutOfService always wins its own CAS on a
    // fresh IN_STORE asset, and reserve() may or may not have raced past it) — the
    // outcome of each individual call is not the point; the end state is.
    expect(['fulfilled', 'rejected']).toContain(oosResult.status);
    expect(['fulfilled', 'rejected']).toContain(reserveResult.status);

    const asset = await assetModel.findById('DRILL-008').lean();
    expect(asset?.status).toBe(AssetStatus.OUT_OF_SERVICE);

    const activeReservations = await reservationModel.countDocuments({ assetId: 'DRILL-008', status: ReservationStatus.ACTIVE });
    expect(activeReservations).toBe(0);
  });
});
