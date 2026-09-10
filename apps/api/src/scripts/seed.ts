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
  // Still valid today, lapses inside the window: the one certification a keeper can act on
  // before it becomes a refusal. Sits after the future booking this worker holds (+5 days),
  // so they are still certified at the moment they collect.
  const expiringSoon = new Date(now.getTime() + 10 * DAY_MS);
  const farFuture = new Date(now.getTime() + 365 * DAY_MS);

  return WORKER_NAMES.map((name, i) => {
    let certifications: { code: string; expiresAt: Date }[];
    if (i === 0) certifications = [{ code: 'GAS-DETECT', expiresAt: longExpired }];
    else if (i === 1) certifications = [{ code: 'HEIGHTS', expiresAt: expiredInWindow }];
    else if (i === 2) certifications = [{ code: 'HEIGHTS', expiresAt: expiringSoon }];
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
  dueAt: Date | null;
  recordedAt: Date;
  idempotencyKey: string;
  correctionOf: Types.ObjectId | null;
  correctedBy: Types.ObjectId | null;
  reservationId: Types.ObjectId | null;
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
  reservations: ReturnType<typeof buildReservations>,
  outOfServiceAssetId: string,
) {
  const movements: SeedMovement[] = [];
  const patches = new Map<string, AssetPatch>();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);

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

  const reservationsByAsset = new Map(reservations.map((r) => [r.assetId, r]));

  for (const asset of assets) {
    // A booked asset gets exactly the movements its booking implies (below), and is kept
    // out of the random traffic that knows nothing about windows.
    if (reservationsByAsset.has(asset._id)) continue;

    if (asset._id === outOfServiceAssetId) {
      const occurredAt = new Date(windowStart.getTime() + 2 * DAY_MS);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: null,
        type: 'OUT_OF_SERVICE',
        occurredAt,
        recordedAt: occurredAt,
        dueAt: null,
        idempotencyKey: `seed-oos-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reservationId: null,
        reason: 'Seeded as damaged',
      });
      patches.set(asset._id, { status: 'OUT_OF_SERVICE', currentHolderId: null, currentMovementId: null });
      continue;
    }

    if (asset._id === overdueAssetId) {
      const worker = pickWorker(asset.requiresCertification);
      const occurredAt = new Date(now.getTime() - 10 * DAY_MS);
      const overdueDueAt = new Date(now.getTime() - 3 * DAY_MS);
      const id = new Types.ObjectId();
      movements.push({
        _id: id,
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt,
        recordedAt: occurredAt,
        dueAt: overdueDueAt,
        idempotencyKey: `seed-issue-overdue-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reservationId: null,
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
        dueAt: new Date(issueOccurredAt.getTime() + 8 * 60 * 60 * 1000),
        idempotencyKey: `seed-issue-late-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reservationId: null,
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
        dueAt: null,
        idempotencyKey: `seed-return-late-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reservationId: null,
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
        dueAt: new Date(issueOccurredAt.getTime() + 8 * 60 * 60 * 1000),
        idempotencyKey: `seed-issue-corrected-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reservationId: null,
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
        dueAt: null,
        idempotencyKey: `seed-return-corrected-${asset._id}`,
        correctionOf: null,
        correctedBy: correctionId,
        reservationId: null,
        reason: null,
      });
      movements.push({
        _id: correctionId,
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: new Date(wrongReturnOccurredAt.getTime() + 60 * 60 * 1000),
        recordedAt: new Date(now.getTime() - 1 * DAY_MS),
        dueAt: null,
        idempotencyKey: `seed-correction-${asset._id}`,
        correctionOf: wrongReturnId,
        correctedBy: null,
        reservationId: null,
        reason: 'Keeper logged the wrong return time',
      });
      patches.set(asset._id, { status: 'IN_STORE', currentHolderId: null, currentMovementId: null });
      continue;
    }

    // Ordinary traffic: 1-3 issue/return pairs across the window; ~15% of assets end up still outstanding.
    // Each pair gets its own slot of the window and lands somewhere inside it, so the thirty days
    // read as thirty days of work rather than a busy first week followed by silence. A loan runs at
    // most 8 hours, well short of the shortest slot, so slots never bleed into one another and the
    // pairs stay in order.
    const pairCount = 1 + Math.floor(rng() * 3);
    const slotMs = (WINDOW_DAYS * DAY_MS) / pairCount;
    const leaveOutstanding = rng() < 0.15;
    let settled = false;

    for (let p = 0; p < pairCount && !settled; p++) {
      const issueOccurredAt = new Date(windowStart.getTime() + (p + rng() * 0.8) * slotMs);
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
        dueAt: new Date(issueOccurredAt.getTime() + 8 * 60 * 60 * 1000),
        idempotencyKey: `seed-issue-${asset._id}-${p}`,
        correctionOf: null,
        correctedBy: null,
        reservationId: null,
        reason: null,
      });

      const isLastPair = p === pairCount - 1;
      const returnOccurredAt = new Date(issueOccurredAt.getTime() + (2 + rng() * 6) * 60 * 60 * 1000);

      if ((isLastPair && leaveOutstanding) || returnOccurredAt.getTime() >= now.getTime()) {
        // Still out: give it a due-back time in the near future, so seeded outstanding
        // items read as on loan rather than overdue — the overdue asset above is the one
        // deliberately past its time.
        const openIssue = movements.find((m) => String(m._id) === String(issueId));
        if (openIssue) openIssue.dueAt = new Date(now.getTime() + (1 + rng() * 3) * DAY_MS);
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
        dueAt: null,
        idempotencyKey: `seed-return-${asset._id}-${p}`,
        correctionOf: null,
        correctedBy: null,
        reservationId: null,
        reason: null,
      });
      patches.set(asset._id, { status: 'IN_STORE', currentHolderId: null, currentMovementId: null });
    }
  }

  // The two bookings that were collected. Collecting pins the loan to the window, so both
  // carry dueAt = the reservation end, and the link is written from both ends.
  for (const reservation of reservations) {
    if (reservation.status !== 'FULFILLED') continue;
    const issueId = new Types.ObjectId();
    const stillOut = reservation.endAt.getTime() < now.getTime() && reservation.idempotencyKey.includes('overdue');

    movements.push({
      _id: issueId,
      assetId: reservation.assetId,
      workerId: reservation.workerId,
      type: 'ISSUE',
      occurredAt: reservation.startAt,
      recordedAt: reservation.startAt,
      dueAt: reservation.endAt,
      idempotencyKey: `seed-issue-collect-${reservation.assetId}`,
      correctionOf: null,
      correctedBy: null,
      reservationId: reservation._id,
      reason: null,
    });
    reservation.fulfilledByMovementId = issueId;

    if (stillOut) {
      // Collected and never brought back: the asset reads overdue and so does the booking.
      patches.set(reservation.assetId, { status: 'ISSUED', currentHolderId: reservation.workerId, currentMovementId: String(issueId) });
    } else {
      movements.push({
        _id: new Types.ObjectId(),
        assetId: reservation.assetId,
        workerId: reservation.workerId,
        type: 'RETURN',
        occurredAt: new Date(reservation.endAt.getTime() - 30 * 60 * 1000),
        recordedAt: new Date(reservation.endAt.getTime() - 30 * 60 * 1000),
        dueAt: null,
        idempotencyKey: `seed-return-collect-${reservation.assetId}`,
        correctionOf: null,
        correctedBy: null,
        reservationId: null,
        reason: null,
      });
    }
  }

  return { movements, patches, outOfServiceAssetId };
}

/**
 * Built before any movement, because a booking constrains who may hold the asset: the
 * ordinary-traffic loop has to know which windows exist before it hands anything out.
 * Otherwise the seed generates the very state the gating forbids — an asset issued to one
 * worker inside another worker's window — which is how that state came to be in the store
 * in the first place.
 *
 * Four bookings, one per ending a reservation can have:
 *  - a future window nobody has collected yet (ACTIVE)
 *  - a past window nobody ever collected (reads NOT_COLLECTED)
 *  - a past window collected and returned (FULFILLED)
 *  - a past window collected and still not back (reads OVERDUE)
 */
interface SeedReservation {
  _id: Types.ObjectId;
  assetId: string;
  workerId: string;
  startAt: Date;
  endAt: Date;
  status: 'ACTIVE' | 'FULFILLED';
  idempotencyKey: string;
  fulfilledByMovementId: Types.ObjectId | null;
}

function buildReservations(
  assets: ReturnType<typeof buildAssets>,
  workers: ReturnType<typeof buildWorkers>,
  now: Date,
  outOfServiceAssetId: string,
): SeedReservation[] {
  const reservable = assets.filter((a) => a._id !== outOfServiceAssetId);
  const upcomingAsset = reservable[reservable.length - 1];
  const neverCollectedAsset = reservable[reservable.length - 2];
  const collectedAndReturnedAsset = reservable[reservable.length - 3];
  const collectedAndOverdueAsset = reservable[reservable.length - 4];

  const hours = (n: number) => n * 60 * 60 * 1000;
  const futureStart = new Date(now.getTime() + 5 * DAY_MS);
  const pastStart = new Date(now.getTime() - 20 * DAY_MS);
  const returnedStart = new Date(now.getTime() - 12 * DAY_MS);
  const overdueStart = new Date(now.getTime() - 4 * DAY_MS);

  return [
    {
      _id: new Types.ObjectId(),
      assetId: upcomingAsset._id,
      workerId: workers[2]._id,
      startAt: futureStart,
      endAt: new Date(futureStart.getTime() + hours(8)),
      status: 'ACTIVE' as const,
      fulfilledByMovementId: null,
      idempotencyKey: `seed-reservation-future-${upcomingAsset._id}`,
    },
    {
      _id: new Types.ObjectId(),
      assetId: neverCollectedAsset._id,
      workerId: workers[3]._id,
      startAt: pastStart,
      endAt: new Date(pastStart.getTime() + hours(8)),
      status: 'ACTIVE' as const,
      fulfilledByMovementId: null,
      idempotencyKey: `seed-reservation-past-${neverCollectedAsset._id}`,
    },
    {
      _id: new Types.ObjectId(),
      assetId: collectedAndReturnedAsset._id,
      workerId: workers[4]._id,
      startAt: returnedStart,
      endAt: new Date(returnedStart.getTime() + hours(8)),
      status: 'FULFILLED' as const,
      fulfilledByMovementId: null,
      idempotencyKey: `seed-reservation-collected-${collectedAndReturnedAsset._id}`,
    },
    {
      _id: new Types.ObjectId(),
      assetId: collectedAndOverdueAsset._id,
      workerId: workers[5]._id,
      startAt: overdueStart,
      endAt: new Date(overdueStart.getTime() + hours(8)),
      status: 'FULFILLED' as const,
      fulfilledByMovementId: null,
      idempotencyKey: `seed-reservation-overdue-${collectedAndOverdueAsset._id}`,
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
    // Bookings first: they decide which assets the traffic loop must leave alone.
    const outOfServiceAssetId = assets[5]._id; // GASD-006
    const reservations = buildReservations(assets, workers, now, outOfServiceAssetId);
    const { movements, patches } = buildMovementsAndPatches(assets, workers, now, rng, reservations, outOfServiceAssetId);

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
