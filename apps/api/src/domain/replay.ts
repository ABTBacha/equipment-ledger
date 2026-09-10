import { MovementType } from '@equipment-ledger/shared';

export interface RawMovement {
  id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  dueAt: Date | null;
  recordedAt: Date;
  correctionOf: string | null;
  correctedBy: string | null;
}

export interface EffectiveMovement {
  id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  dueAt: Date | null;
}

export interface AssetReplayState {
  status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
  holderId: string | null;
  /** When the current holder is due to bring it back; null unless the asset is out on an issue that named a time. */
  dueAt: Date | null;
}

/**
 * The one place a stored Movement document is narrowed to what replaying the ledger
 * needs. Four callers replay (the as-of endpoint, an asset's own history, the
 * invariant checker, and the correction-ordering guard); they all read the same
 * fields, so a field added to the ledger only has to be threaded through here.
 */
export function toRawMovement(doc: {
  _id: unknown;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  dueAt?: Date | null;
  recordedAt: Date;
  correctionOf?: unknown;
  correctedBy?: unknown;
}): RawMovement {
  return {
    id: String(doc._id),
    assetId: doc.assetId,
    workerId: doc.workerId,
    type: doc.type,
    occurredAt: doc.occurredAt,
    dueAt: doc.dueAt ?? null,
    recordedAt: doc.recordedAt,
    correctionOf: doc.correctionOf ? String(doc.correctionOf) : null,
    correctedBy: doc.correctedBy ? String(doc.correctedBy) : null,
  };
}

export function resolveEffectiveMovements(rawMovements: RawMovement[]): EffectiveMovement[] {
  const byId = new Map(rawMovements.map((m) => [m.id, m]));
  const result: EffectiveMovement[] = [];

  for (const m of rawMovements) {
    if (m.correctionOf !== null) continue; // corrections are folded into the original's slot, not listed separately
    const effectiveSource = m.correctedBy !== null ? byId.get(m.correctedBy) : undefined;
    const source = effectiveSource ?? m;
    result.push({
      id: m.id,
      assetId: m.assetId,
      workerId: source.workerId,
      type: source.type,
      occurredAt: source.occurredAt,
      dueAt: source.dueAt ?? null,
    });
  }

  return result;
}

export function replayStoreState(movements: EffectiveMovement[], asOf: Date): Map<string, AssetReplayState> {
  const eligible = movements
    .filter((m) => m.occurredAt.getTime() <= asOf.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));

  const state = new Map<string, AssetReplayState>();

  for (const m of eligible) {
    if (m.type === MovementType.ISSUE) {
      state.set(m.assetId, { status: 'ISSUED', holderId: m.workerId, dueAt: m.dueAt ?? null });
    } else if (m.type === MovementType.RETURN) {
      state.set(m.assetId, { status: 'IN_STORE', holderId: null, dueAt: null });
    } else if (m.type === MovementType.OUT_OF_SERVICE) {
      state.set(m.assetId, { status: 'OUT_OF_SERVICE', holderId: null, dueAt: null });
    } else if (m.type === MovementType.BACK_IN_SERVICE) {
      state.set(m.assetId, { status: 'IN_STORE', holderId: null, dueAt: null });
    }
  }

  return state;
}
