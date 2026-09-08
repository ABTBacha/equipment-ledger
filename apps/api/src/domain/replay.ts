import { MovementType } from '@equipment-ledger/shared';

export interface RawMovement {
  id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
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
}

export interface AssetReplayState {
  status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
  holderId: string | null;
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
      state.set(m.assetId, { status: 'ISSUED', holderId: m.workerId });
    } else if (m.type === MovementType.RETURN) {
      state.set(m.assetId, { status: 'IN_STORE', holderId: null });
    } else if (m.type === MovementType.OUT_OF_SERVICE) {
      state.set(m.assetId, { status: 'OUT_OF_SERVICE', holderId: null });
    } else if (m.type === MovementType.BACK_IN_SERVICE) {
      state.set(m.assetId, { status: 'IN_STORE', holderId: null });
    }
  }

  return state;
}
