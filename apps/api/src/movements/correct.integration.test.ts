import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';

describe('MovementsService.correct', () => {
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
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
  });

  it('corrects a movement, leaving the original untouched except correctedBy', async () => {
    const original = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'c-issue-1' });
    const correction = await service.correct(String(original._id), {
      occurredAt: '2026-08-01T09:15:00Z',
      reason: 'Logged the wrong minute',
      idempotencyKey: 'c-correct-1',
    });
    expect(String(correction.assetId)).toBe('DRILL-001');
    expect(new Date(correction.occurredAt).toISOString()).toBe('2026-08-01T09:15:00.000Z');
    expect(correction.correctionOf).toBe(String(original._id));

    const reloadedOriginal = await movementModel.findById(original._id).lean();
    expect(String(reloadedOriginal?.correctedBy)).toBe(String(correction._id));
    expect(new Date(reloadedOriginal!.occurredAt).toISOString()).toBe('2026-08-01T09:00:00.000Z');
  });

  it('rejects correcting a movement that has already been corrected', async () => {
    const original = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'c-issue-2' });
    await service.correct(String(original._id), { occurredAt: '2026-08-01T09:15:00Z', idempotencyKey: 'c-correct-2' });
    await expect(
      service.correct(String(original._id), { occurredAt: '2026-08-01T09:20:00Z', idempotencyKey: 'c-correct-3' }),
    ).rejects.toThrow(/already been corrected/);
  });

  it('returns 404 (NotFoundException) when correcting a nonexistent movement', async () => {
    await expect(
      service.correct('64b64b64b64b64b64b64b64', { occurredAt: '2026-08-01T09:20:00Z', idempotencyKey: 'c-correct-4' }),
    ).rejects.toThrow(/not found/i);
  });

  it('lets exactly one of two simultaneous corrections with different idempotencyKeys succeed, leaving the original pointing at the winner', async () => {
    const original = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'c-issue-race' });

    const [a, b] = await Promise.allSettled([
      service.correct(String(original._id), { occurredAt: '2026-08-01T09:10:00Z', reason: 'attempt A', idempotencyKey: 'c-correct-race-a' }),
      service.correct(String(original._id), { occurredAt: '2026-08-01T09:11:00Z', reason: 'attempt B', idempotencyKey: 'c-correct-race-b' }),
    ]);

    const results = [a, b];
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason.message).toMatch(/already been corrected/);

    const winner = (succeeded[0] as PromiseFulfilledResult<any>).value;
    const reloadedOriginal = await movementModel.findById(original._id).lean();
    expect(String(reloadedOriginal?.correctedBy)).toBe(String(winner._id));

    // NOTE: `correctionOf` is stored as a real ObjectId, but the schema's `@Prop` for it
    // resolves to Mixed (a pre-existing quirk unrelated to this task), so Mongoose does not
    // auto-cast a plain hex string in a query filter the way it does for `_id`. Cast explicitly.
    const correctionCount = await movementModel.countDocuments({ correctionOf: new Types.ObjectId(original._id) });
    expect(correctionCount).toBe(1);
  });

  it('replays the same result instead of conflicting when two simultaneous corrections share the same idempotencyKey (double-click)', async () => {
    const original = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'c-issue-dbl' });
    const dto = { occurredAt: '2026-08-01T09:10:00Z', reason: 'double click', idempotencyKey: 'c-correct-dbl' };

    const [a, b] = await Promise.all([
      service.correct(String(original._id), dto),
      service.correct(String(original._id), dto),
    ]);

    expect(String(a._id)).toBe(String(b._id));

    const correctionCount = await movementModel.countDocuments({ correctionOf: new Types.ObjectId(original._id) });
    expect(correctionCount).toBe(1);

    const reloadedOriginal = await movementModel.findById(original._id).lean();
    expect(String(reloadedOriginal?.correctedBy)).toBe(String(a._id));
  });
});
