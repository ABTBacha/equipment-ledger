import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { WorkersModule } from './workers.module';
import { WorkersService } from './workers.service';
import { MovementsModule } from '../movements/movements.module';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('WorkersService', () => {
  let service: WorkersService;
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
    await service['movementsService'].issue({ assetId: 'DRILL-003', workerId: 'worker-2', idempotencyKey: 'wk-issue-1' });

    const worker = await service.findOne('worker-2');
    expect(worker.currentlyHolding).toHaveLength(1);
    expect(worker.currentlyHolding[0]._id).toBe('DRILL-003');
  });

  it('findOne throws NotFoundException for an unknown worker', async () => {
    await expect(service.findOne('nope')).rejects.toThrow(/not found/i);
  });
});
