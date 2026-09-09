import mongoose, { Types } from 'mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';

const SEED = 1337;
const DAY_MS = 24 * 60 * 60 * 1000;
const ASSET_COUNT = 60;
const WINDOW_DAYS = 30;

function mulberry32(seed: number) {
  let s = seed;
  return function random() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ASSET_KINDS = [
  { kind: 'drill', prefix: 'DRILL', requiresCertification: null as string | null },
  { kind: 'grinder', prefix: 'GRIND', requiresCertification: null as string | null },
  { kind: 'ladder', prefix: 'LADR', requiresCertification: null as string | null },
  { kind: 'generator', prefix: 'GEN', requiresCertification: null as string | null },
  { kind: 'harness', prefix: 'HARN', requiresCertification: 'HEIGHTS' },
  { kind: 'gas-detector', prefix: 'GASD', requiresCertification: 'GAS-DETECT' },
];

const WORKER_NAMES = [
  'Ana Rios', 'Ben Cole', 'Chidi Okoye', 'Dana Kim', 'Elif Sari', 'Farid Hassan',
  'Grace Lin', 'Hugo Alves', 'Ines Duarte', 'Jamal Reed', 'Kira Novak', 'Liu Wei',
];

function slugify(name: string): string {
  return 'worker-' + name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildAssets() {
  const assets: { _id: string; kind: string; requiresCertification: string | null }[] = [];
  for (let i = 0; i < ASSET_COUNT; i++) {
    const kindDef = ASSET_KINDS[i % ASSET_KINDS.length];
    const code = `${kindDef.prefix}-${String(i + 1).padStart(3, '0')}`;
    assets.push({ _id: code, kind: kindDef.kind, requiresCertification: kindDef.requiresCertification });
  }
  return assets;
}

function buildWorkers(now: Date) {
  const longExpired = new Date(now.getTime() - 60 * DAY_MS);
  const expiredInWindow = new Date(now.getTime() - 15 * DAY_MS);
  const farFuture = new Date(now.getTime() + 365 * DAY_MS);

  return WORKER_NAMES.map((name, i) => {
    let certifications: { code: string; expiresAt: Date }[];
    if (i === 0) certifications = [{ code: 'GAS-DETECT', expiresAt: longExpired }];
    else if (i === 1) certifications = [{ code: 'HEIGHTS', expiresAt: expiredInWindow }];
    else if (i % 2 === 0) certifications = [{ code: 'HEIGHTS', expiresAt: farFuture }];
    else certifications = [{ code: 'GAS-DETECT', expiresAt: farFuture }];
    return { _id: slugify(name), name, certifications };
  });
}

interface SeedMovement {
  _id: Types.ObjectId;
  assetId: string;
  workerId: string | null;
  type: string;
  occurredAt: Date;
  recordedAt: Date;
  idempotencyKey: string;
  correctionOf: Types.ObjectId | null;
  correctedBy: Types.ObjectId | null;
  reason: string | null;
}

interface AssetPatch {
  status: string;
  currentHolderId: string | null;
  currentMovementId: string | null;
}

function buildMovementsAndPatches(
  assets: ReturnType<typeof buildAssets>,
  workers: ReturnType<typeof buildWorkers>,
  now: Date,
  rng: () => number,
) {
  const movements: SeedMovement[] = [];
  const patches = new Map<string, AssetPatch>();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);

  const outOfServiceAssetId = assets[5]._id; // GASD-006
  const overdueAssetId = assets[0]._id; // DRILL-001
  const lateLoggedAssetId = assets[1]._id; // GRIND-002
  const correctedAssetId = assets[2]._id; // LADR-003

  const eligibleWorkersFor = (requiresCertification: string | null) =>
    requiresCertification === null
      ? workers
      : workers.filter((w) => w.certifications.some((c) => c.code === requiresCertification && c.expiresAt.getTime() > now.getTime()));

  const pickWorker = (requiresCertification: string | null) => {
    const pool = eligibleWorkersFor(requiresCertification);
    const from = pool.length > 0 ? pool : workers;
    return from[Math.floor(rng() * from.length)];
  };

  for (const asset of assets) {
    if (asset._id === outOfServiceAssetId) {
      const occurredAt = new Date(windowStart.getTime() + 2 * DAY_MS);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: null,
        type: 'OUT_OF_SERVICE',
        occurredAt,
        recordedAt: occurredAt,
        idempotencyKey: `seed-oos-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: 'Seeded as damaged',
      });
      patches.set(asset._id, { status: 'OUT_OF_SERVICE', currentHolderId: null, currentMovementId: null });
      continue;
    }

    if (asset._id === overdueAssetId) {
      const worker = pickWorker(asset.requiresCertification);
      const occurredAt = new Date(now.getTime() - 10 * DAY_MS);
      const id = new Types.ObjectId();
      movements.push({
        _id: id,
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt,
        recordedAt: occurredAt,
        idempotencyKey: `seed-issue-overdue-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      patches.set(asset._id, { status: 'ISSUED', currentHolderId: worker._id, currentMovementId: String(id) });
      continue;
    }

    if (asset._id === lateLoggedAssetId) {
      const worker = pickWorker(asset.requiresCertification);
      const issueOccurredAt = new Date(windowStart.getTime() + 5 * DAY_MS);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt: issueOccurredAt,
        recordedAt: issueOccurredAt,
        idempotencyKey: `seed-issue-late-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      const returnOccurredAt = new Date(issueOccurredAt.getTime() + 8 * 60 * 60 * 1000);
      const returnRecordedAt = new Date(returnOccurredAt.getTime() + 2 * 60 * 60 * 1000 + 40 * 60 * 1000);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: returnOccurredAt,
        recordedAt: returnRecordedAt,
        idempotencyKey: `seed-return-late-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      patches.set(asset._id, { status: 'IN_STORE', currentHolderId: null, currentMovementId: null });
      continue;
    }

    if (asset._id === correctedAssetId) {
      const worker = pickWorker(asset.requiresCertification);
      const issueOccurredAt = new Date(windowStart.getTime() + 3 * DAY_MS);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt: issueOccurredAt,
        recordedAt: issueOccurredAt,
        idempotencyKey: `seed-issue-corrected-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      const wrongReturnId = new Types.ObjectId();
      const correctionId = new Types.ObjectId();
      const wrongReturnOccurredAt = new Date(issueOccurredAt.getTime() + 8 * 60 * 60 * 1000);
      movements.push({
        _id: wrongReturnId,
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: wrongReturnOccurredAt,
        recordedAt: wrongReturnOccurredAt,
        idempotencyKey: `seed-return-corrected-${asset._id}`,
        correctionOf: null,
        correctedBy: correctionId,
        reason: null,
      });
      movements.push({
        _id: correctionId,
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: new Date(wrongReturnOccurredAt.getTime() + 60 * 60 * 1000),
        recordedAt: new Date(now.getTime() - 1 * DAY_MS),
        idempotencyKey: `seed-correction-${asset._id}`,
        correctionOf: wrongReturnId,
        correctedBy: null,
        reason: 'Keeper logged the wrong return time',
      });
      patches.set(asset._id, { status: 'IN_STORE', currentHolderId: null, currentMovementId: null });
      continue;
    }

    // Ordinary traffic: 1-3 issue/return pairs across the window; ~15% of assets end up still outstanding.
    const pairCount = 1 + Math.floor(rng() * 3);
    let cursor = windowStart;
    const leaveOutstanding = rng() < 0.15;
    let settled = false;

    for (let p = 0; p < pairCount && !settled; p++) {
      const issueOccurredAt = new Date(cursor.getTime() + rng() * 2 * DAY_MS);
      if (issueOccurredAt.getTime() >= now.getTime()) break;

      const worker = pickWorker(asset.requiresCertification);
      const issueId = new Types.ObjectId();
      movements.push({
        _id: issueId,
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt: issueOccurredAt,
        recordedAt: issueOccurredAt,
        idempotencyKey: `seed-issue-${asset._id}-${p}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });

      const isLastPair = p === pairCount - 1;
      const returnOccurredAt = new Date(issueOccurredAt.getTime() + (2 + rng() * 6) * 60 * 60 * 1000);

      if ((isLastPair && leaveOutstanding) || returnOccurredAt.getTime() >= now.getTime()) {
        patches.set(asset._id, { status: 'ISSUED', currentHolderId: worker._id, currentMovementId: String(issueId) });
        settled = true;
        break;
      }

      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: returnOccurredAt,
        recordedAt: returnOccurredAt,
        idempotencyKey: `seed-return-${asset._id}-${p}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      patches.set(asset._id, { status: 'IN_STORE', currentHolderId: null, currentMovementId: null });
      cursor = returnOccurredAt;
    }
  }

  return { movements, patches, outOfServiceAssetId };
}

function buildReservations(assets: ReturnType<typeof buildAssets>, workers: ReturnType<typeof buildWorkers>, now: Date, outOfServiceAssetId: string) {
  const reservable = assets.filter((a) => a._id !== outOfServiceAssetId);
  const neverCollectedAsset = reservable[reservable.length - 1];
  const pastActiveAsset = reservable[reservable.length - 2];

  const futureStart = new Date(now.getTime() + 5 * DAY_MS);
  const futureEnd = new Date(futureStart.getTime() + 8 * 60 * 60 * 1000);
  const pastStart = new Date(now.getTime() - 20 * DAY_MS);
  const pastEnd = new Date(pastStart.getTime() + 8 * 60 * 60 * 1000);

  return [
    {
      assetId: neverCollectedAsset._id,
      workerId: workers[2]._id,
      startAt: futureStart,
      endAt: futureEnd,
      status: 'ACTIVE',
      idempotencyKey: `seed-reservation-future-${neverCollectedAsset._id}`,
    },
    {
      assetId: pastActiveAsset._id,
      workerId: workers[3]._id,
      startAt: pastStart,
      endAt: pastEnd,
      status: 'ACTIVE',
      idempotencyKey: `seed-reservation-past-${pastActiveAsset._id}`,
    },
  ];
}

export async function seed(uri: string, now: Date = new Date()) {
  const conn = await mongoose.createConnection(uri).asPromise();
  const AssetModel = conn.model(Asset.name, AssetSchema);
  const WorkerModel = conn.model(Worker.name, WorkerSchema);
  const MovementModel = conn.model(Movement.name, MovementSchema);
  const ReservationModel = conn.model(Reservation.name, ReservationSchema);
  const AssetLockModel = conn.model(AssetLock.name, AssetLockSchema);

  try {
    await Promise.all([
      AssetModel.deleteMany({}),
      WorkerModel.deleteMany({}),
      MovementModel.deleteMany({}),
      ReservationModel.deleteMany({}),
      AssetLockModel.deleteMany({}),
    ]);

    const rng = mulberry32(SEED);
    const assets = buildAssets();
    const workers = buildWorkers(now);
    const { movements, patches, outOfServiceAssetId } = buildMovementsAndPatches(assets, workers, now, rng);
    const reservations = buildReservations(assets, workers, now, outOfServiceAssetId);

    await WorkerModel.insertMany(workers);

    const assetDocs = assets.map((a) => {
      const patch = patches.get(a._id);
      return {
        _id: a._id,
        kind: a.kind,
        requiresCertification: a.requiresCertification,
        status: patch?.status ?? 'IN_STORE',
        currentHolderId: patch?.currentHolderId ?? null,
        currentMovementId: patch?.currentMovementId ?? null,
        updatedAt: now,
      };
    });
    await AssetModel.insertMany(assetDocs);

    if (movements.length > 0) await MovementModel.insertMany(movements);
    if (reservations.length > 0) await ReservationModel.insertMany(reservations);

    return {
      assetCount: assetDocs.length,
      workerCount: workers.length,
      movementCount: movements.length,
      reservationCount: reservations.length,
      outOfServiceAssetId,
    };
  } finally {
    await conn.close();
  }
}

async function main() {
  const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/equipment_ledger?replicaSet=rs0';
  const result = await seed(uri);
  console.log(`Seeded ${result.assetCount} assets, ${result.workerCount} workers, ${result.movementCount} movements, ${result.reservationCount} reservations.`);
}

if (require.main === module) {
  main();
}
