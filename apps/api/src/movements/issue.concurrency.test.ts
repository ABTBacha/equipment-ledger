import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus } from '@equipment-ledger/shared';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';

describe('MovementsService.issue concurrency', () => {
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

  it('lets exactly one of 10 simultaneous issue requests for the same asset succeed', async () => {
    await assetModel.deleteMany({});
    await workerModel.deleteMany({});
    await movementModel.deleteMany({});
    await assetModel.create({ _id: 'DRILL-RACE', kind: 'drill', requiresCertification: null });
    for (let i = 0; i < 10; i++) {
      await workerModel.create({ _id: `worker-race-${i}`, name: `Worker ${i}`, certifications: [] });
    }

    const attempts = Array.from({ length: 10 }, (_, i) =>
      service.issue({
        assetId: 'DRILL-RACE',
        workerId: `worker-race-${i}`,
        dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
        idempotencyKey: `race-key-${i}`,
      }),
    );
    const settled = await Promise.allSettled(attempts);

    const succeeded = settled.filter((s) => s.status === 'fulfilled');
    const failed = settled.filter((s) => s.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(9);

    const movementCount = await movementModel.countDocuments({ assetId: 'DRILL-RACE' });
    expect(movementCount).toBe(1);
    const asset = await assetModel.findById('DRILL-RACE').lean();
    expect(asset?.status).toBe(AssetStatus.ISSUED);
  });
});
