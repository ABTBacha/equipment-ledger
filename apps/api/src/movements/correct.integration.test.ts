import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { replayStoreState, resolveEffectiveMovements, toRawMovement } from '../domain/replay';

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
    expect(correction.reason).toBe('Logged the wrong minute');

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

    // `correctionOf` is declared with `type: SchemaTypes.ObjectId` in movement.schema.ts (not
    // `Types.ObjectId`, the BSON value-construction class, which @nestjs/mongoose's
    // DefinitionsFactory.isMongooseSchemaType() fails to recognize and silently falls back to a
    // Mixed path for) — so Mongoose properly casts this plain hex-string filter value to an
    // ObjectId for the query, the same as it does for `_id`.
    const correctionCount = await movementModel.countDocuments({ correctionOf: original._id });
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

    const correctionCount = await movementModel.countDocuments({ correctionOf: original._id });
    expect(correctionCount).toBe(1);

    const reloadedOriginal = await movementModel.findById(original._id).lean();
    expect(String(reloadedOriginal?.correctedBy)).toBe(String(a._id));
  });

  it('persists loggedBy end-to-end from issue and correct through to the stored Movement document', async () => {
    const original = await service.issue({
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T09:00:00Z',
      idempotencyKey: 'c-issue-logged',
      loggedBy: 'Priya Patel',
    });
    const storedIssue = await movementModel.findById(original._id).lean();
    expect(storedIssue?.loggedBy).toBe('Priya Patel');

    const correction = await service.correct(String(original._id), {
      occurredAt: '2026-08-01T09:15:00Z',
      idempotencyKey: 'c-correct-logged',
      loggedBy: 'Marcus Webb',
    });
    const storedCorrection = await movementModel.findById(correction._id).lean();
    expect(storedCorrection?.loggedBy).toBe('Marcus Webb');
  });

  describe('ordering validation', () => {
    // A correction may fix when something happened, but it may not reorder the ledger:
    // live asset state is derived from the movement sequence, so a correction that jumped
    // a neighbouring movement would leave the screens and a ledger replay disagreeing
    // about who is holding what.

    it('refuses to move a return back before the issue it closes', async () => {
      await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-1' });
      const ret = await service.return({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ord-return-1' });

      await expect(
        service.correct(String(ret._id), { occurredAt: '2026-08-01T08:00:00Z', idempotencyKey: 'ord-correct-1' }),
      ).rejects.toThrow(/2026-08-01T09:00:00.000Z/);
    });

    it('refuses to move an issue forward past the return that closed it', async () => {
      const issue = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-2' });
      await service.return({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ord-return-2' });

      await expect(
        service.correct(String(issue._id), { occurredAt: '2026-08-01T18:00:00Z', idempotencyKey: 'ord-correct-2' }),
      ).rejects.toThrow(/2026-08-01T17:00:00.000Z/);
    });

    it('refuses a correction that lands exactly on a neighbouring movement, rather than relying on a tiebreak', async () => {
      await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-3' });
      const ret = await service.return({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ord-return-3' });

      await expect(
        service.correct(String(ret._id), { occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-correct-3' }),
      ).rejects.toThrow(/2026-08-01T09:00:00.000Z/);
    });

    it('refuses a correction dated into the future', async () => {
      const issue = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-4' });
      const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();

      await expect(
        service.correct(String(issue._id), { occurredAt: tomorrow, idempotencyKey: 'ord-correct-4' }),
      ).rejects.toThrow(/future/i);
    });

    it('refuses to move a damaged return past the out-of-service movement it triggered', async () => {
      await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-5' });
      const ret = await service.return({
        assetId: 'DRILL-001',
        workerId: 'worker-1',
        occurredAt: '2026-08-01T17:00:00Z',
        outOfService: true,
        idempotencyKey: 'ord-return-5',
      });

      await expect(
        service.correct(String(ret._id), { occurredAt: '2026-08-01T17:30:00Z', idempotencyKey: 'ord-correct-5' }),
      ).rejects.toThrow(/2026-08-01T17:00:00.001Z/);
    });

    it('accepts a correction that stays between its neighbours', async () => {
      await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-6' });
      const ret = await service.return({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ord-return-6' });
      await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-02T09:00:00Z', idempotencyKey: 'ord-issue-6b' });

      const corrected = await service.correct(String(ret._id), { occurredAt: '2026-08-01T16:00:00Z', idempotencyKey: 'ord-correct-6' });
      expect(new Date(corrected.occurredAt).toISOString()).toBe('2026-08-01T16:00:00.000Z');
    });

    it('accepts moving the most recent movement backward, since it has no later neighbour', async () => {
      await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-7' });
      const ret = await service.return({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ord-return-7' });

      const corrected = await service.correct(String(ret._id), { occurredAt: '2026-08-01T09:30:00Z', idempotencyKey: 'ord-correct-7' });
      expect(new Date(corrected.occurredAt).toISOString()).toBe('2026-08-01T09:30:00.000Z');
    });

    it('ignores movements on other assets when bounding a correction', async () => {
      await assetModel.create({ _id: 'DRILL-009', kind: 'drill', requiresCertification: null });
      await service.issue({ assetId: 'DRILL-009', workerId: 'worker-1', occurredAt: '2026-08-01T10:00:00Z', idempotencyKey: 'ord-other-issue' });
      const issue = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-8' });

      const corrected = await service.correct(String(issue._id), { occurredAt: '2026-08-01T12:00:00Z', idempotencyKey: 'ord-correct-8' });
      expect(new Date(corrected.occurredAt).toISOString()).toBe('2026-08-01T12:00:00.000Z');
    });

    it('leaves the live asset state agreeing with a ledger replay after a refused correction', async () => {
      await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'ord-issue-9' });
      const ret = await service.return({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ord-return-9' });

      await expect(
        service.correct(String(ret._id), { occurredAt: '2026-08-01T08:00:00Z', idempotencyKey: 'ord-correct-9' }),
      ).rejects.toThrow();

      const live = await assetModel.findById('DRILL-001').lean();
      const docs = await movementModel.find({}).lean();
      const replayed = replayStoreState(
        resolveEffectiveMovements(docs.map(toRawMovement)),
        new Date(),
      );

      expect(live!.status).toBe('IN_STORE');
      expect(replayed.get('DRILL-001')?.status ?? 'IN_STORE').toBe('IN_STORE');
      expect(replayed.get('DRILL-001')?.holderId ?? null).toBeNull();
    });
  });

  describe('due-back corrections', () => {
    it('carries a corrected dueAt without touching the original', async () => {
      const issue = await service.issue({
        assetId: 'DRILL-001',
        workerId: 'worker-1',
        occurredAt: '2026-08-01T09:00:00Z',
        dueAt: '2026-08-01T12:00:00Z',
        idempotencyKey: 'due-corr-issue',
      });

      const correction = await service.correct(String(issue._id), {
        dueAt: '2026-08-01T17:00:00Z',
        reason: 'Agreed a later drop-off',
        idempotencyKey: 'due-corr-1',
      });

      expect(new Date(correction.dueAt!).toISOString()).toBe('2026-08-01T17:00:00.000Z');
      expect(new Date(correction.occurredAt).toISOString()).toBe('2026-08-01T09:00:00.000Z');
      const original = await movementModel.findById(issue._id).lean();
      expect(new Date(original!.dueAt!).toISOString()).toBe('2026-08-01T12:00:00.000Z');
    });

    it('keeps the original dueAt when a correction only changes the time it happened', async () => {
      const issue = await service.issue({
        assetId: 'DRILL-001',
        workerId: 'worker-1',
        occurredAt: '2026-08-01T09:00:00Z',
        dueAt: '2026-08-01T12:00:00Z',
        idempotencyKey: 'due-corr-issue-2',
      });

      const correction = await service.correct(String(issue._id), {
        occurredAt: '2026-08-01T09:30:00Z',
        idempotencyKey: 'due-corr-2',
      });

      expect(new Date(correction.dueAt!).toISOString()).toBe('2026-08-01T12:00:00.000Z');
    });
  });
});
