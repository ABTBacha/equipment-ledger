// This test walks the brief's "main scenario" verbatim against a freshly seeded store, and
// doubles as the literal script to follow when recording the submission video: issue -> a
// concurrent second issue rejected, twice at once -> a backdated return -> a correction of
// that return's time -> an "as of" query an hour before the sequence, checked for consistency
// with the live /assets endpoint.
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module';
import { seed } from './scripts/seed';

describe('Main scenario (e2e)', () => {
  let app: INestApplication;
  const fixedNow = new Date('2026-09-08T12:00:00Z');
  const RESERVED_SEED_ASSETS = new Set(['DRILL-001', 'GRIND-002', 'LADR-003', 'GASD-006']);

  beforeAll(async () => {
    await seed(process.env.MONGO_URI!, fixedNow);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues, rejects a concurrent second issue, accepts a backdated return, corrects it, and answers an as-of query consistently', async () => {
    const assetsBefore = await request(app.getHttpServer()).get('/assets').expect(200);
    const scenarioAsset = assetsBefore.body.find(
      (a: { _id: string; status: string; requiresCertification: string | null }) =>
        a.status === 'IN_STORE' && a.requiresCertification === null && !RESERVED_SEED_ASSETS.has(a._id),
    );
    expect(scenarioAsset).toBeDefined();
    const scenarioAssetId = scenarioAsset._id;
    const scenarioWorkerA = 'worker-ana-rios';
    const scenarioWorkerB = 'worker-ben-cole';
    // Anchored to fixedNow + 1h (not inside the seed's own 30-day movement-generation window),
    // so the new scenario's ISSUE is chronologically after every seeded movement for every
    // asset, regardless of which asset the seed's RNG happens to hand us as the first match.
    // seed() guarantees no generated movement's occurredAt ever reaches or exceeds `fixedNow`
    // itself, so fixedNow + 1h is a safe anchor no matter which asset is picked.
    const sequenceStart = new Date(fixedNow.getTime() + 60 * 60 * 1000);

    // 1. Issue.
    await request(app.getHttpServer())
      .post('/movements/issue')
      .send({ assetId: scenarioAssetId, workerId: scenarioWorkerA, occurredAt: sequenceStart.toISOString(), idempotencyKey: 'e2e-issue-1' })
      .expect(201);

    // 2. Try to issue the same asset again, concurrently, twice at once.
    const [a, b] = await Promise.allSettled([
      request(app.getHttpServer())
        .post('/movements/issue')
        .send({ assetId: scenarioAssetId, workerId: scenarioWorkerB, idempotencyKey: 'e2e-issue-race-a' }),
      request(app.getHttpServer())
        .post('/movements/issue')
        .send({ assetId: scenarioAssetId, workerId: scenarioWorkerB, idempotencyKey: 'e2e-issue-race-b' }),
    ]);
    const raceStatuses = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.status : null));
    expect(raceStatuses.filter((s) => s === 409)).toHaveLength(2);

    // 3. Return it with a backdated time.
    const backdatedReturnAt = new Date(sequenceStart.getTime() + 4 * 60 * 60 * 1000);
    const returnRes = await request(app.getHttpServer())
      .post('/movements/return')
      .send({ assetId: scenarioAssetId, workerId: scenarioWorkerA, occurredAt: backdatedReturnAt.toISOString(), idempotencyKey: 'e2e-return-1' })
      .expect(201);

    // 4. Correct that time.
    const correctedReturnAt = new Date(backdatedReturnAt.getTime() + 60 * 60 * 1000);
    await request(app.getHttpServer())
      .post(`/movements/${returnRes.body._id}/correct`)
      .send({ occurredAt: correctedReturnAt.toISOString(), reason: 'Logged the return an hour early', idempotencyKey: 'e2e-correct-1' })
      .expect(201);

    // 5. Ask what the store looked like an hour before all of this: this asset should not
    //    appear held by anyone yet.
    const asOfBefore = new Date(sequenceStart.getTime() - 60 * 60 * 1000);
    const storeBefore = await request(app.getHttpServer())
      .get(`/store?asOf=${encodeURIComponent(asOfBefore.toISOString())}`)
      .expect(200);
    expect(storeBefore.body.assets[scenarioAssetId]?.status ?? 'IN_STORE').toBe('IN_STORE');
    expect(storeBefore.body.assets[scenarioAssetId]?.holderId ?? null).toBeNull();

    // 6. The "as of now" answer must be consistent with every other screen (the live /assets endpoint).
    const storeNow = await request(app.getHttpServer()).get('/store').expect(200);
    const assetNow = await request(app.getHttpServer()).get(`/assets/${scenarioAssetId}`).expect(200);
    expect(storeNow.body.assets[scenarioAssetId].status).toBe(assetNow.body.status);
    expect(storeNow.body.assets[scenarioAssetId].holderId).toBe(assetNow.body.currentHolderId);
  });
});
