import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus } from '@equipment-ledger/shared';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';

describe('MovementsService.return', () => {
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
    await workerModel.create({ _id: 'worker-2', name: 'Ben Cole', certifications: [] });
  });

  async function issueDrill(assetId: string, occurredAt: Date) {
    await assetModel.create({ _id: assetId, kind: 'drill', requiresCertification: null });
    return service.issue({ assetId, workerId: 'worker-1', occurredAt: occurredAt.toISOString(), idempotencyKey: `issue-${assetId}` });
  }

  it('returns an issued asset and sets it back to IN_STORE', async () => {
    await issueDrill('DRILL-001', new Date('2026-08-01T09:00:00Z'));
    const result = await service.return({
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T17:00:00Z',
      idempotencyKey: 'ret-1',
    });
    expect(result.type).toBe('RETURN');
    const asset = await assetModel.findById('DRILL-001').lean();
    expect(asset?.status).toBe(AssetStatus.IN_STORE);
    expect(asset?.currentHolderId).toBeNull();
  });

  it('rejects a return by the wrong worker with a distinguishing message', async () => {
    await issueDrill('DRILL-002', new Date('2026-08-01T09:00:00Z'));
    await expect(
      service.return({ assetId: 'DRILL-002', workerId: 'worker-2', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ret-2' }),
    ).rejects.toThrow(/currently held by worker-1/);
  });

  it('rejects returning an asset that is not currently issued', async () => {
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null });
    await expect(
      service.return({ assetId: 'DRILL-003', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ret-3' }),
    ).rejects.toThrow(/not currently issued/);
  });

  it('rejects a backdated return before its own issue time', async () => {
    await issueDrill('DRILL-004', new Date('2026-08-01T09:00:00Z'));
    await expect(
      service.return({ assetId: 'DRILL-004', workerId: 'worker-1', occurredAt: '2026-08-01T08:00:00Z', idempotencyKey: 'ret-4' }),
    ).rejects.toThrow(/before the issue time/);
  });

  it('marks the asset OUT_OF_SERVICE when outOfService is true, recording both movements', async () => {
    await issueDrill('DRILL-005', new Date('2026-08-01T09:00:00Z'));
    await service.return({
      assetId: 'DRILL-005',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T17:00:00Z',
      idempotencyKey: 'ret-5',
      outOfService: true,
    });
    const asset = await assetModel.findById('DRILL-005').lean();
    expect(asset?.status).toBe(AssetStatus.OUT_OF_SERVICE);
    const movements = await movementModel.find({ assetId: 'DRILL-005', type: { $in: ['RETURN', 'OUT_OF_SERVICE'] } }).lean();
    expect(movements).toHaveLength(2);
  });

  it('replays the same result instead of conflicting when two simultaneous return requests share the same idempotencyKey (double-click)', async () => {
    await issueDrill('DRILL-006', new Date('2026-08-01T09:00:00Z'));
    const dto = {
      assetId: 'DRILL-006',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T17:00:00Z',
      idempotencyKey: 'ret-6',
    };
    const [a, b] = await Promise.all([service.return(dto), service.return(dto)]);
    expect(a._id).toBe(b._id);
    expect(a.type).toBe('RETURN');
    const asset = await assetModel.findById('DRILL-006').lean();
    expect(asset?.status).toBe(AssetStatus.IN_STORE);
    const count = await movementModel.countDocuments({ assetId: 'DRILL-006', type: 'RETURN' });
    expect(count).toBe(1);
  });
});
