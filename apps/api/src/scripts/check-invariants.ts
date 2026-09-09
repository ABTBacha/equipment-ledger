import mongoose from 'mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { RawMovement, replayStoreState, resolveEffectiveMovements } from '../domain/replay';
import { intervalsOverlap } from '../domain/intervals';

export interface InvariantViolation {
  rule: string;
  detail: string;
}

export async function checkInvariants(uri: string): Promise<InvariantViolation[]> {
  const conn = await mongoose.createConnection(uri).asPromise();
  const AssetModel = conn.model(Asset.name, AssetSchema);
  const MovementModel = conn.model(Movement.name, MovementSchema);
  const ReservationModel = conn.model(Reservation.name, ReservationSchema);

  const violations: InvariantViolation[] = [];

  try {
    const assets = await AssetModel.find({}).lean();
    const movementDocs = await MovementModel.find({}).lean();
    const raw: RawMovement[] = movementDocs.map((m) => ({
      id: String(m._id),
      assetId: m.assetId,
      workerId: m.workerId,
      type: m.type,
      occurredAt: m.occurredAt,
      recordedAt: m.recordedAt,
      correctionOf: m.correctionOf ? String(m.correctionOf) : null,
      correctedBy: m.correctedBy ? String(m.correctedBy) : null,
    }));
    const effective = resolveEffectiveMovements(raw);
    const replayed = replayStoreState(effective, new Date());

    // Rule 1: replayed current-state matches every live Asset document exactly.
    for (const asset of assets) {
      const state = replayed.get(asset._id);
      const expectedStatus = state?.status ?? 'IN_STORE';
      const expectedHolder = state?.holderId ?? null;
      if (asset.status !== expectedStatus || asset.currentHolderId !== expectedHolder) {
        violations.push({
          rule: 'replay-matches-live-state',
          detail: `Asset ${asset._id}: live (${asset.status}, holder=${asset.currentHolderId}) != replayed (${expectedStatus}, holder=${expectedHolder})`,
        });
      }
    }

    // Rule 2: no asset ever has two open (unreturned) ISSUE movements at once.
    const byAsset = new Map<string, typeof effective>();
    for (const m of effective) {
      const list = byAsset.get(m.assetId) ?? [];
      list.push(m);
      byAsset.set(m.assetId, list);
    }
    for (const [assetId, moves] of byAsset) {
      const sorted = [...moves].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
      let currentlyIssued = false;
      for (const m of sorted) {
        if (m.type === 'ISSUE') {
          if (currentlyIssued) {
            violations.push({ rule: 'no-double-open-movement', detail: `Asset ${assetId} has two open ISSUE movements around ${m.occurredAt.toISOString()}` });
          }
          currentlyIssued = true;
        } else {
          currentlyIssued = false;
        }
      }
    }

    // Rule 3: no two ACTIVE reservations on the same asset overlap.
    const activeReservations = await ReservationModel.find({ status: 'ACTIVE' }).lean();
    const byAssetRes = new Map<string, typeof activeReservations>();
    for (const r of activeReservations) {
      const list = byAssetRes.get(r.assetId) ?? [];
      list.push(r);
      byAssetRes.set(r.assetId, list);
    }
    for (const [assetId, reservations] of byAssetRes) {
      for (let i = 0; i < reservations.length; i++) {
        for (let j = i + 1; j < reservations.length; j++) {
          if (intervalsOverlap(reservations[i].startAt, reservations[i].endAt, reservations[j].startAt, reservations[j].endAt)) {
            violations.push({
              rule: 'no-overlapping-reservations',
              detail: `Asset ${assetId} has overlapping reservations ${reservations[i]._id} and ${reservations[j]._id}`,
            });
          }
        }
      }
    }

    // Rule 4: every correction references a real, once-only-corrected original, bidirectionally consistent.
    const movementById = new Map(movementDocs.map((m) => [String(m._id), m]));
    const correctionOfCounts = new Map<string, number>();
    for (const m of movementDocs) {
      if (m.correctionOf) {
        const key = String(m.correctionOf);
        correctionOfCounts.set(key, (correctionOfCounts.get(key) ?? 0) + 1);
        const original = movementById.get(key);
        if (!original) {
          violations.push({ rule: 'correction-integrity', detail: `Movement ${m._id} corrects a nonexistent movement ${key}` });
        } else if (String(original.correctedBy) !== String(m._id)) {
          violations.push({ rule: 'correction-integrity', detail: `Original movement ${key} correctedBy does not point back to its correction ${m._id}` });
        }
      }
    }
    for (const [originalId, count] of correctionOfCounts) {
      if (count > 1) {
        violations.push({ rule: 'correction-integrity', detail: `Movement ${originalId} has been corrected more than once` });
      }
    }

    // Reverse direction: a movement with correctedBy set must be checked too, even if
    // nothing's correctionOf pointed at it from the forward pass above (e.g. a stale or
    // wrong forward pointer, or a corrupted/nonexistent correctedBy target).
    for (const m of movementDocs) {
      if (m.correctedBy) {
        const key = String(m.correctedBy);
        const correction = movementById.get(key);
        if (!correction) {
          violations.push({ rule: 'correction-integrity', detail: `Movement ${m._id} has correctedBy pointing at nonexistent movement ${key}` });
        } else if (String(correction.correctionOf) !== String(m._id)) {
          violations.push({ rule: 'correction-integrity', detail: `Movement ${m._id} has correctedBy=${key}, but that movement's correctionOf does not point back to ${m._id}` });
        }
      }
    }

    return violations;
  } finally {
    await conn.close();
  }
}

async function main() {
  const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/equipment_ledger?replicaSet=rs0';
  const violations = await checkInvariants(uri);
  if (violations.length === 0) {
    console.log('OK: no invariant violations found.');
    process.exit(0);
  }
  console.error(`FAILED: ${violations.length} invariant violation(s) found:`);
  for (const v of violations) console.error(`  [${v.rule}] ${v.detail}`);
  process.exit(1);
}

if (require.main === module) {
  main();
}
