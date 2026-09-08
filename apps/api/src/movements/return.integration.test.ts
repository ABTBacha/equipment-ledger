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

  it('replays the winning movement instead of conflicting when this attempt\'s CAS write loses a same-idempotencyKey race (double-click)', async () => {
    await issueDrill('DRILL-006', new Date('2026-08-01T09:00:00Z'));
    const dto = {
      assetId: 'DRILL-006',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T17:00:00Z',
      idempotencyKey: 'ret-6',
    };

    // A genuine timing race (Promise.all with two real service.return(dto) calls, with or
    // without an artificial delay on the CAS write) does not reliably land on this branch:
    // executeReturn reads-and-validates (status/holder/backdate) before its CAS write, unlike
    // executeIssue where the CAS is the very first operation. Whichever call's snapshot began
    // before the other committed hits a MongoDB write conflict on its own CAS attempt, which
    // aborts the whole transaction with a TransientTransactionError; withTransaction/withRetries
    // then re-run the *entire* executeReturn, and the retried pre-check sees the now-committed
    // state and correctly rejects with "not currently issued" before ever reaching the CAS. So
    // instead we simulate the narrow window the fallback exists for directly: the CAS predicate
    // no longer matches (a concurrent request with the identical idempotencyKey has just won
    // and committed) while this call's earlier pre-checks had already passed against the
    // pre-race state.
    let winningMovementId: string | undefined;
    const spy = jest.spyOn(assetModel, 'findOneAndUpdate').mockImplementation((() => {
      return (async () => {
        const winner = await movementModel.create({
          assetId: dto.assetId,
          workerId: dto.workerId,
          type: 'RETURN',
          occurredAt: new Date(dto.occurredAt),
          recordedAt: new Date(),
          idempotencyKey: dto.idempotencyKey,
          correctionOf: null,
          correctedBy: null,
          reason: null,
        });
        winningMovementId = winner._id.toString();
        await assetModel.updateOne(
          { _id: dto.assetId },
          { $set: { status: AssetStatus.IN_STORE, currentHolderId: null, currentMovementId: null } },
        );
        return null;
      })();
    }) as unknown as typeof assetModel.findOneAndUpdate);

    let result: Awaited<ReturnType<typeof service.return>>;
    try {
      result = await service.return(dto);
    } finally {
      spy.mockRestore();
    }

    expect(result._id).toBe(winningMovementId);
    expect(result.type).toBe('RETURN');
    const asset = await assetModel.findById('DRILL-006').lean();
    expect(asset?.status).toBe(AssetStatus.IN_STORE);
    const movements = await movementModel.find({ assetId: 'DRILL-006', type: 'RETURN' }).lean();
    expect(movements).toHaveLength(1);
  });
});
