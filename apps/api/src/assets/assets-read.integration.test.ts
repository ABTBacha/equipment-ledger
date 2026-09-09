import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetsModule } from './assets.module';
import { AssetsService } from './assets.service';
import { MovementsModule } from '../movements/movements.module';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('AssetsService reads', () => {
  let service: AssetsService;
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
        ]),
        MovementsModule,
        AssetsModule,
      ],
    }).compile();

    service = moduleRef.get(AssetsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), workerModel.deleteMany({}), reservationModel.deleteMany({})]);
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
  });

  it('findAll annotates the nearest upcoming ACTIVE reservation per asset', async () => {
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
    await reservationModel.create({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: new Date('2027-03-01T09:00Z'), endAt: new Date('2027-03-01T17:00Z'), idempotencyKey: 'r1' });
    const all = await service.findAll();
    const drill = all.find((a) => a._id === 'DRILL-001');
    expect(drill?.upcomingReservation?.workerId).toBe('worker-1');
  });

  it('findAll reports lastActivityAt as the latest movement occurredAt, or null with no movements', async () => {
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null });
    await assetModel.create({ _id: 'DRILL-004', kind: 'drill', requiresCertification: null });

    await service['movementsService'].issue({
      assetId: 'DRILL-003',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T09:00:00Z',
      idempotencyKey: 'activity-issue-1',
    });
    await service['movementsService'].return({
      assetId: 'DRILL-003',
      workerId: 'worker-1',
      occurredAt: '2026-08-02T09:00:00Z',
      idempotencyKey: 'activity-return-1',
    });

    const all = await service.findAll();
    const withActivity = all.find((a) => a._id === 'DRILL-003');
    const withoutActivity = all.find((a) => a._id === 'DRILL-004');

    expect(withActivity?.lastActivityAt).toEqual(new Date('2026-08-02T09:00:00Z'));
    expect(withoutActivity?.lastActivityAt).toBeNull();
  });

  it('findOne throws NotFoundException for an unknown asset', async () => {
    await expect(service.findOne('NOPE-001')).rejects.toThrow(/not found/i);
  });

  it('getHistory pairs a corrected movement with its correction', async () => {
    await assetModel.create({ _id: 'DRILL-002', kind: 'drill', requiresCertification: null });
    const issued = await service['movementsService'].issue({ assetId: 'DRILL-002', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'hist-issue-1' });
    await service['movementsService'].correct(String(issued._id), { occurredAt: '2026-08-01T09:05:00Z', idempotencyKey: 'hist-correct-1' });

    const history = await service.getHistory('DRILL-002');
    expect(history).toHaveLength(1);
    expect(String(history[0].movement._id)).toBe(String(issued._id));
    expect(history[0].correction).not.toBeNull();
  });
});
