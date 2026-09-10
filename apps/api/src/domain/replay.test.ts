import { MovementType } from '@equipment-ledger/shared';
import { resolveEffectiveMovements, replayStoreState, RawMovement } from './replay';

const d = (s: string) => new Date(s);

function raw(overrides: Partial<RawMovement> & Pick<RawMovement, 'id' | 'assetId' | 'workerId' | 'type' | 'occurredAt'>): RawMovement {
  return {
    recordedAt: overrides.occurredAt,
    correctionOf: null,
    correctedBy: null,
    ...overrides,
  } as RawMovement;
}

describe('resolveEffectiveMovements', () => {
  it('uses the correction occurredAt instead of the original when a correction exists', () => {
    const original = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T09:00Z'), correctedBy: 'm2' });
    const correction = raw({ id: 'm2', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T11:00Z'), correctionOf: 'm1' });
    const effective = resolveEffectiveMovements([original, correction]);
    const m1Effective = effective.find((m) => m.id === 'm1');
    expect(m1Effective?.occurredAt).toEqual(d('2026-08-01T11:00Z'));
    expect(effective.find((m) => m.id === 'm2')).toBeUndefined();
  });

  it('passes through uncorrected movements unchanged', () => {
    const m = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') });
    expect(resolveEffectiveMovements([m])).toEqual([{ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z'), dueAt: null }]);
  });
});

describe('replayStoreState', () => {
  it('leaves an asset held if asOf is after its ISSUE with no RETURN', () => {
    const movements = resolveEffectiveMovements([
      raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }),
    ]);
    const state = replayStoreState(movements, d('2026-08-01T10:00Z'));
    expect(state.get('A1')).toEqual({ status: 'ISSUED', holderId: 'W1', dueAt: null });
  });

  it('excludes a RETURN that happens after asOf', () => {
    const movements = resolveEffectiveMovements([
      raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }),
      raw({ id: 'm2', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T17:00Z') }),
    ]);
    const state = replayStoreState(movements, d('2026-08-01T12:00Z'));
    expect(state.get('A1')).toEqual({ status: 'ISSUED', holderId: 'W1', dueAt: null });
  });

  it('is inclusive of a movement exactly at asOf', () => {
    const movements = resolveEffectiveMovements([
      raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }),
    ]);
    const state = replayStoreState(movements, d('2026-08-01T09:00Z'));
    expect(state.get('A1')).toEqual({ status: 'ISSUED', holderId: 'W1', dueAt: null });
  });

  it('returns an empty map (nothing held) when asOf is before the earliest movement', () => {
    const movements = resolveEffectiveMovements([
      raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }),
    ]);
    const state = replayStoreState(movements, d('2026-01-01T00:00Z'));
    expect(state.get('A1')).toBeUndefined();
  });

  it('uses the corrected occurredAt when deciding inclusion in the asOf window', () => {
    const original = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T09:00Z'), correctedBy: 'm2' });
    const correction = raw({ id: 'm2', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T20:00Z'), correctionOf: 'm1' });
    const issue = raw({ id: 'm0', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T08:00Z') });
    const movements = resolveEffectiveMovements([issue, original, correction]);
    const state = replayStoreState(movements, d('2026-08-01T12:00Z'));
    expect(state.get('A1')).toEqual({ status: 'ISSUED', holderId: 'W1', dueAt: null });
  });
});

describe('replayed due-back time', () => {
  it('reports the dueAt of the issue an asset is currently out on', () => {
    const issue = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z'), dueAt: d('2026-08-01T17:00Z') });
    const state = replayStoreState(resolveEffectiveMovements([issue]), d('2026-08-01T12:00Z'));
    expect(state.get('A1')?.dueAt).toEqual(d('2026-08-01T17:00Z'));
  });

  it('clears the dueAt once the asset is back in store', () => {
    const issue = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z'), dueAt: d('2026-08-01T17:00Z') });
    const ret = raw({ id: 'm2', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T16:00Z') });
    const state = replayStoreState(resolveEffectiveMovements([issue, ret]), d('2026-08-01T18:00Z'));
    expect(state.get('A1')?.dueAt).toBeNull();
  });

  it('uses a corrected dueAt rather than the original', () => {
    const issue = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z'), dueAt: d('2026-08-01T12:00Z'), correctedBy: 'm2' });
    const correction = raw({ id: 'm2', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z'), dueAt: d('2026-08-01T17:00Z'), correctionOf: 'm1' });
    const state = replayStoreState(resolveEffectiveMovements([issue, correction]), d('2026-08-01T13:00Z'));
    expect(state.get('A1')?.dueAt).toEqual(d('2026-08-01T17:00Z'));
  });
});
