import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { ZodExceptionFilter } from '../common/zod-exception.filter';
import { Asset } from '../schemas/asset.schema';
import { Reservation } from '../schemas/reservation.schema';

describe('POST /reservations/:id/cancel (e2e)', () => {
  let app: INestApplication;
  let assetModel: Model<Asset>;
  let reservationModel: Model<Reservation>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ZodExceptionFilter());
    await app.init();
    assetModel = moduleRef.get(getModelToken(Asset.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), reservationModel.deleteMany({})]);
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
  });

  async function createReservation(idempotencyKey: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/reservations')
      .send({
        assetId: 'DRILL-001',
        workerId: 'worker-1',
        startAt: '2027-05-10T09:00:00.000Z',
        endAt: '2027-05-10T17:00:00.000Z',
        idempotencyKey,
      })
      .expect(201);
    return res.body._id;
  }

  it('cancels an active reservation and returns it with the reason', async () => {
    const id = await createReservation('e2e-cancel-1');

    const res = await request(app.getHttpServer())
      .post(`/reservations/${id}/cancel`)
      .send({ reason: 'Job postponed' })
      .expect(201);

    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.cancelReason).toBe('Job postponed');
  });

  it('returns 409 when the reservation is already cancelled', async () => {
    const id = await createReservation('e2e-cancel-2');
    await request(app.getHttpServer()).post(`/reservations/${id}/cancel`).send({}).expect(201);

    await request(app.getHttpServer()).post(`/reservations/${id}/cancel`).send({}).expect(409);
  });

  it('returns 404 for an unknown reservation', async () => {
    await request(app.getHttpServer()).post('/reservations/64b7f9c2f1a2b3c4d5e6f7a8/cancel').send({}).expect(404);
  });

  it('returns 400 for a malformed body rather than silently ignoring it', async () => {
    const id = await createReservation('e2e-cancel-3');
    await request(app.getHttpServer()).post(`/reservations/${id}/cancel`).send({ reason: '' }).expect(400);
  });
});
