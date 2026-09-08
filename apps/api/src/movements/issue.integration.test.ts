import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus } from '@equipment-ledger/shared';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';

describe('MovementsService.issue', () => {
  let service: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
  let movementModel: Model<Movement>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
        ]),
        MovementsModule,
      ],
    }).compile();

    service = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    movementModel = moduleRef.get(getModelToken(Movement.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), workerModel.deleteMany({}), movementModel.deleteMany({})]);
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
    await workerModel.create({ _id: 'worker-2', name: 'Ben Cole', certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2020-01-01') }] });
  });

  it('issues an in-store asset and returns the movement', async () => {
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
    const result = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', idempotencyKey: 'k1' });
    expect(result.type).toBe('ISSUE');
    const asset = await assetModel.findById('DRILL-001').lean();
    expect(asset?.status).toBe(AssetStatus.ISSUED);
    expect(asset?.currentHolderId).toBe('worker-1');
  });

  it('refuses issue when the required certification is expired, and writes no movement', async () => {
    await assetModel.create({ _id: 'GAS-001', kind: 'gas-detector', requiresCertification: 'GAS-DETECT' });
    await expect(service.issue({ assetId: 'GAS-001', workerId: 'worker-2', idempotencyKey: 'k2' })).rejects.toThrow(/expired/i);
    const count = await movementModel.countDocuments({ assetId: 'GAS-001' });
    expect(count).toBe(0);
  });

  it('rejects a second issue of the same asset with 409', async () => {
    await assetModel.create({ _id: 'DRILL-002', kind: 'drill', requiresCertification: null });
    await service.issue({ assetId: 'DRILL-002', workerId: 'worker-1', idempotencyKey: 'k3' });
    await expect(service.issue({ assetId: 'DRILL-002', workerId: 'worker-2', idempotencyKey: 'k4' })).rejects.toThrow(/not available/i);
  });

  it('replays the original result on a retried idempotencyKey instead of double-issuing', async () => {
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null });
    const first = await service.issue({ assetId: 'DRILL-003', workerId: 'worker-1', idempotencyKey: 'k5' });
    const second = await service.issue({ assetId: 'DRILL-003', workerId: 'worker-1', idempotencyKey: 'k5' });
    expect(second._id).toBe(first._id);
    const count = await movementModel.countDocuments({ assetId: 'DRILL-003' });
    expect(count).toBe(1);
  });
});
