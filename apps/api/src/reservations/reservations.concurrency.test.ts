import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { ReservationsModule } from './reservations.module';
import { ReservationsService } from './reservations.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';

describe('ReservationsService.reserve concurrency', () => {
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

  it('lets exactly one of two simultaneous overlapping reservation requests succeed', async () => {
    await assetModel.deleteMany({});
    await reservationModel.deleteMany({});
    await assetModel.create({ _id: 'DRILL-RACE', kind: 'drill', requiresCertification: null });

    const [a, b] = await Promise.allSettled([
      service.reserve({ assetId: 'DRILL-RACE', workerId: 'worker-a', startAt: '2027-02-01T09:00:00Z', endAt: '2027-02-01T17:00:00Z', idempotencyKey: 'race-a' }),
      service.reserve({ assetId: 'DRILL-RACE', workerId: 'worker-b', startAt: '2027-02-01T10:00:00Z', endAt: '2027-02-01T18:00:00Z', idempotencyKey: 'race-b' }),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

    const count = await reservationModel.countDocuments({ assetId: 'DRILL-RACE', status: 'ACTIVE' });
    expect(count).toBe(1);
  });

  it('lets a double-click (identical idempotencyKey, identical window) both resolve to the same reservation', async () => {
    await assetModel.deleteMany({});
    await reservationModel.deleteMany({});
    await assetModel.create({ _id: 'DRILL-DOUBLECLICK', kind: 'drill', requiresCertification: null });

    const request = {
      assetId: 'DRILL-DOUBLECLICK',
      workerId: 'worker-dc',
      startAt: '2027-03-01T09:00:00Z',
      endAt: '2027-03-01T17:00:00Z',
      idempotencyKey: 'double-click-key',
    };

    const [a, b] = await Promise.all([service.reserve(request), service.reserve(request)]);

    expect(a._id).toBe(b._id);
    expect(a.status).toBe('ACTIVE');
    expect(b.status).toBe('ACTIVE');

    const count = await reservationModel.countDocuments({ assetId: 'DRILL-DOUBLECLICK' });
    expect(count).toBe(1);
  });
});
