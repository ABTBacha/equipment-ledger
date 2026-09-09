import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { ZodExceptionFilter } from '../common/zod-exception.filter';
import { Worker } from '../schemas/worker.schema';

describe('worker certification routes (e2e)', () => {
  let app: INestApplication;
  let workerModel: Model<Worker>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ZodExceptionFilter());
    await app.init();
    workerModel = moduleRef.get(getModelToken(Worker.name));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await workerModel.deleteMany({ _id: 'worker-e2e-certs' });
    await workerModel.create({ _id: 'worker-e2e-certs', name: 'Erin Falk', certifications: [] });
  });

  it('adds a certification and returns the updated worker', async () => {
    const res = await request(app.getHttpServer())
      .put('/workers/worker-e2e-certs/certifications/FORKLIFT')
      .send({ expiresAt: '2028-01-01T00:00:00.000Z' })
      .expect(200);

    expect(res.body.certifications).toEqual([{ code: 'FORKLIFT', expiresAt: '2028-01-01T00:00:00.000Z' }]);
  });

  it('removes a certification and returns the updated worker', async () => {
    await request(app.getHttpServer())
      .put('/workers/worker-e2e-certs/certifications/FORKLIFT')
      .send({ expiresAt: '2028-01-01T00:00:00.000Z' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .delete('/workers/worker-e2e-certs/certifications/FORKLIFT')
      .expect(200);

    expect(res.body.certifications).toEqual([]);
  });

  it('returns 400 for an expiry that is not a timestamp', async () => {
    await request(app.getHttpServer())
      .put('/workers/worker-e2e-certs/certifications/FORKLIFT')
      .send({ expiresAt: 'next tuesday' })
      .expect(400);
  });

  it('returns 404 for an unknown worker', async () => {
    await request(app.getHttpServer())
      .put('/workers/nobody/certifications/FORKLIFT')
      .send({ expiresAt: '2028-01-01T00:00:00.000Z' })
      .expect(404);
  });
});
