import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { WorkersModule } from './workers.module';
import { WorkersService } from './workers.service';
import { MovementsModule } from '../movements/movements.module';
import { MovementsService } from '../movements/movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('WorkersService', () => {
  let service: WorkersService;
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
        WorkersModule,
      ],
    }).compile();

    service = moduleRef.get(WorkersService);
    movementsService = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  it('findOne reports the assets a worker currently holds', async () => {
    await workerModel.create({ _id: 'worker-2', name: 'Ben Cole', certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2020-01-01') }] });
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null });
    await movementsService.issue({ assetId: 'DRILL-003', workerId: 'worker-2', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'wk-issue-1' });

    const worker = await service.findOne('worker-2');
    expect(worker.currentlyHolding).toHaveLength(1);
    expect(worker.currentlyHolding[0]._id).toBe('DRILL-003');
  });

  it('findOne throws NotFoundException for an unknown worker', async () => {
    await expect(service.findOne('nope')).rejects.toThrow(/not found/i);
  });

  it('findAll reports each worker\'s currently held assets without an N+1 query per worker', async () => {
    await workerModel.create({ _id: 'worker-findall-holder', name: 'Cara Diaz', certifications: [] });
    await workerModel.create({ _id: 'worker-findall-empty', name: 'Dev Singh', certifications: [] });
    await assetModel.create({ _id: 'TESTASSET-FINDALL-1', kind: 'drill', requiresCertification: null });
    await assetModel.create({ _id: 'TESTASSET-FINDALL-2', kind: 'drill', requiresCertification: null });
    await movementsService.issue({ assetId: 'TESTASSET-FINDALL-1', workerId: 'worker-findall-holder', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'wk-issue-2' });
    await movementsService.issue({ assetId: 'TESTASSET-FINDALL-2', workerId: 'worker-findall-holder', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'wk-issue-3' });

    const findSpy = jest.spyOn(assetModel, 'find');
    const workers = await service.findAll();
    // AssetsService.findAll() should be called exactly once for the whole list, not once per worker.
    expect(findSpy).toHaveBeenCalledTimes(1);
    findSpy.mockRestore();

    const cara = workers.find((w) => w._id === 'worker-findall-holder')!;
    const dev = workers.find((w) => w._id === 'worker-findall-empty')!;
    expect(cara.currentlyHolding.map((a) => a._id).sort()).toEqual(['TESTASSET-FINDALL-1', 'TESTASSET-FINDALL-2']);
    expect(dev.currentlyHolding).toEqual([]);
  });

  describe('certifications', () => {
    beforeEach(async () => {
      await workerModel.deleteMany({ _id: 'worker-certs' });
      await workerModel.create({ _id: 'worker-certs', name: 'Erin Falk', certifications: [] });
    });

    it('adds a certification the worker does not yet hold', async () => {
      const worker = await service.upsertCertification('worker-certs', {
        code: 'FORKLIFT',
        expiresAt: '2028-01-01T00:00:00.000Z',
      });

      expect(worker.certifications).toEqual([{ code: 'FORKLIFT', expiresAt: new Date('2028-01-01T00:00:00.000Z') }]);
    });

    it('renews a certification the worker already holds, in place, rather than duplicating the code', async () => {
      await service.upsertCertification('worker-certs', { code: 'FORKLIFT', expiresAt: '2020-01-01T00:00:00.000Z' });

      const worker = await service.upsertCertification('worker-certs', {
        code: 'FORKLIFT',
        expiresAt: '2029-06-30T00:00:00.000Z',
      });

      expect(worker.certifications).toEqual([{ code: 'FORKLIFT', expiresAt: new Date('2029-06-30T00:00:00.000Z') }]);
    });

    it('leaves the worker\'s other certifications untouched when renewing one', async () => {
      await service.upsertCertification('worker-certs', { code: 'FORKLIFT', expiresAt: '2028-01-01T00:00:00.000Z' });
      await service.upsertCertification('worker-certs', { code: 'GAS-DETECT', expiresAt: '2028-02-01T00:00:00.000Z' });

      const worker = await service.upsertCertification('worker-certs', {
        code: 'FORKLIFT',
        expiresAt: '2030-01-01T00:00:00.000Z',
      });

      expect(worker.certifications).toEqual([
        { code: 'FORKLIFT', expiresAt: new Date('2030-01-01T00:00:00.000Z') },
        { code: 'GAS-DETECT', expiresAt: new Date('2028-02-01T00:00:00.000Z') },
      ]);
    });

    it('removes a certification by code', async () => {
      await service.upsertCertification('worker-certs', { code: 'FORKLIFT', expiresAt: '2028-01-01T00:00:00.000Z' });
      await service.upsertCertification('worker-certs', { code: 'GAS-DETECT', expiresAt: '2028-02-01T00:00:00.000Z' });

      const worker = await service.removeCertification('worker-certs', 'FORKLIFT');

      expect(worker.certifications.map((c) => c.code)).toEqual(['GAS-DETECT']);
    });

    it('unblocks a cert-gated issue once an expired certification is renewed', async () => {
      await service.upsertCertification('worker-certs', { code: 'FORKLIFT', expiresAt: '2020-01-01T00:00:00.000Z' });
      await assetModel.deleteMany({ _id: 'FORK-001' });
      await assetModel.create({ _id: 'FORK-001', kind: 'forklift', requiresCertification: 'FORKLIFT' });

      await expect(
        movementsService.issue({ assetId: 'FORK-001', workerId: 'worker-certs', dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idempotencyKey: 'cert-issue-1' }),
      ).rejects.toThrow(/expired/i);

      await service.upsertCertification('worker-certs', { code: 'FORKLIFT', expiresAt: '2029-01-01T00:00:00.000Z' });

      const movement = await movementsService.issue({
        assetId: 'FORK-001',
        workerId: 'worker-certs',
        dueAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
        idempotencyKey: 'cert-issue-2',
      });
      expect(movement.type).toBe('ISSUE');
    });

    it('rejects adding a certification to an unknown worker', async () => {
      await expect(
        service.upsertCertification('nobody', { code: 'FORKLIFT', expiresAt: '2028-01-01T00:00:00.000Z' }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects removing a certification the worker does not hold', async () => {
      await expect(service.removeCertification('worker-certs', 'FORKLIFT')).rejects.toThrow(
        /does not hold certification FORKLIFT/i,
      );
    });

    it('rejects removing a certification from an unknown worker', async () => {
      await expect(service.removeCertification('nobody', 'FORKLIFT')).rejects.toThrow(/not found/i);
    });
  });
});
