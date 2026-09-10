import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { StoreModule } from './store.module';
import { StoreService } from './store.service';
import { MovementsModule } from '../movements/movements.module';
import { MovementsService } from '../movements/movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('StoreService.getStoreAsOf', () => {
  let storeService: StoreService;
  let movementsService: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;

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
        StoreModule,
      ],
    }).compile();

    storeService = moduleRef.get(StoreService);
    movementsService = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  it('reconstructs held/free state as of a past instant, and agrees with live Asset state as of now', async () => {
    await assetModel.deleteMany({});
    await workerModel.deleteMany({});
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
    await assetModel.create({ _id: 'DRILL-STORE-1', kind: 'drill', requiresCertification: null });

    await movementsService.issue({ assetId: 'DRILL-STORE-1', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'store-issue-1' });
    await movementsService.return({ assetId: 'DRILL-STORE-1', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'store-return-1' });

    const midway = await storeService.getStoreAsOf(new Date('2026-08-01T12:00:00Z'));
    expect(midway.get('DRILL-STORE-1')).toEqual({ status: 'ISSUED', holderId: 'worker-1', dueAt: null });

    const afterReturn = await storeService.getStoreAsOf(new Date('2026-08-01T18:00:00Z'));
    expect(afterReturn.get('DRILL-STORE-1')).toEqual({ status: 'IN_STORE', holderId: null, dueAt: null });

    const asOfNow = await storeService.getStoreAsOf(new Date());
    const liveAsset = await assetModel.findById('DRILL-STORE-1').lean();
    expect(asOfNow.get('DRILL-STORE-1')?.status).toBe(liveAsset?.status);
    expect(asOfNow.get('DRILL-STORE-1')?.holderId).toBe(liveAsset?.currentHolderId);
  });

  it('answers whether an asset was overdue as of the instant asked about, not as of now', async () => {
    await assetModel.create({ _id: 'DRILL-STORE-9', kind: 'drill', requiresCertification: null });
    await movementsService.issue({
      assetId: 'DRILL-STORE-9',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T09:00:00Z',
      dueAt: '2026-08-01T12:00:00Z',
      idempotencyKey: 'store-overdue-1',
    });

    const beforeDue = await storeService.getStoreAsOf(new Date('2026-08-01T11:00:00Z'));
    const afterDue = await storeService.getStoreAsOf(new Date('2026-08-01T13:00:00Z'));

    expect(beforeDue.get('DRILL-STORE-9')?.dueAt).toEqual(new Date('2026-08-01T12:00:00Z'));
    expect(storeService.isOverdueAsOf(beforeDue.get('DRILL-STORE-9')!, new Date('2026-08-01T11:00:00Z'))).toBe(false);
    expect(storeService.isOverdueAsOf(afterDue.get('DRILL-STORE-9')!, new Date('2026-08-01T13:00:00Z'))).toBe(true);
  });
});
