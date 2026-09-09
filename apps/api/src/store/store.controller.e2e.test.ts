import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { ZodExceptionFilter } from '../common/zod-exception.filter';

describe('GET /store (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ZodExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 (not 500) for an unparseable asOf timestamp', async () => {
    const res = await request(app.getHttpServer()).get('/store?asOf=not-a-date').expect(400);
    expect(res.body.statusCode).toBe(400);
  });

  it('returns 200 with no asOf (defaults to now)', async () => {
    await request(app.getHttpServer()).get('/store').expect(200);
  });

  it('returns 200 for a well-formed asOf timestamp', async () => {
    await request(app.getHttpServer()).get(`/store?asOf=${encodeURIComponent(new Date().toISOString())}`).expect(200);
  });
});
