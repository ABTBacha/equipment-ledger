import {
  IssueMovementSchema,
  ReturnMovementSchema,
  CorrectMovementSchema,
  CreateReservationSchema,
} from './dtos';

describe('IssueMovementSchema', () => {
  it('accepts a valid payload', () => {
    const result = IssueMovementSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      idempotencyKey: 'a1b2c3',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing idempotencyKey', () => {
    const result = IssueMovementSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
    });
    expect(result.success).toBe(false);
  });
});

describe('ReturnMovementSchema', () => {
  it('accepts outOfService as optional boolean', () => {
    const result = ReturnMovementSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      idempotencyKey: 'k1',
      outOfService: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('CorrectMovementSchema', () => {
  it('accepts a corrected occurredAt and reason', () => {
    const result = CorrectMovementSchema.safeParse({
      occurredAt: '2026-08-01T09:00:00.000Z',
      reason: 'Logged the wrong time',
      idempotencyKey: 'k2',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty body', () => {
    const result = CorrectMovementSchema.safeParse({ idempotencyKey: 'k3' });
    expect(result.success).toBe(false);
  });
});

describe('CreateReservationSchema', () => {
  it('accepts a valid window', () => {
    const result = CreateReservationSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      startAt: '2026-10-01T09:00:00.000Z',
      endAt: '2026-10-01T17:00:00.000Z',
      idempotencyKey: 'k4',
    });
    expect(result.success).toBe(true);
  });

  it('rejects endAt <= startAt', () => {
    const result = CreateReservationSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      startAt: '2026-10-01T17:00:00.000Z',
      endAt: '2026-10-01T09:00:00.000Z',
      idempotencyKey: 'k5',
    });
    expect(result.success).toBe(false);
  });
});

describe('dueAt', () => {
  it('accepts an issue carrying a due-back time', () => {
    const result = IssueMovementSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      idempotencyKey: 'k1',
      dueAt: '2026-09-11T17:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a due-back time that is not a timestamp', () => {
    const result = IssueMovementSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      idempotencyKey: 'k1',
      dueAt: 'tomorrow-ish',
    });
    expect(result.success).toBe(false);
  });

  it('lets a correction carry dueAt on its own, since a mistyped due time is worth fixing', () => {
    const result = CorrectMovementSchema.safeParse({
      idempotencyKey: 'k1',
      dueAt: '2026-09-11T17:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});
