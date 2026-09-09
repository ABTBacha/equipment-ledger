import { Types } from 'mongoose';
import { MovementType } from '@equipment-ledger/shared';
import { toMovementResult, RawMovementDoc } from './movement-result';

describe('toMovementResult', () => {
  it('passes reason through from the raw document', () => {
    const raw: RawMovementDoc = {
      _id: new Types.ObjectId(),
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      type: MovementType.OUT_OF_SERVICE,
      occurredAt: new Date('2026-08-01T09:00:00Z'),
      recordedAt: new Date('2026-08-01T09:00:01Z'),
      idempotencyKey: 'key-1',
      correctionOf: null,
      reason: 'Returned damaged',
    };

    const result = toMovementResult(raw);

    expect(result.reason).toBe('Returned damaged');
  });

  it('normalizes a missing reason to null', () => {
    const raw: RawMovementDoc = {
      _id: new Types.ObjectId(),
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      type: MovementType.ISSUE,
      occurredAt: new Date('2026-08-01T09:00:00Z'),
      recordedAt: new Date('2026-08-01T09:00:01Z'),
      idempotencyKey: 'key-2',
      correctionOf: null,
      reason: null,
    };

    const result = toMovementResult(raw);
    expect(result.reason).toBeNull();
  });
});
