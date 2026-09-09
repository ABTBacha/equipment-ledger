import { Types } from 'mongoose';
import { ReservationStatus } from '@equipment-ledger/shared';
import { toReservationResult, RawReservationDoc } from './reservation-result';

function makeReservation(overrides: Partial<RawReservationDoc>): RawReservationDoc {
  return {
    _id: new Types.ObjectId(),
    assetId: 'DRILL-001',
    workerId: 'worker-1',
    startAt: new Date('2026-01-01T09:00:00Z'),
    endAt: new Date('2026-01-01T10:00:00Z'),
    status: ReservationStatus.ACTIVE,
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

describe('toReservationResult', () => {
  it('computes EXPIRED for an ACTIVE reservation whose window has already passed', () => {
    const doc = makeReservation({ startAt: new Date('2020-01-01T09:00:00Z'), endAt: new Date('2020-01-01T10:00:00Z') });
    expect(toReservationResult(doc).status).toBe(ReservationStatus.EXPIRED);
  });

  it('leaves an ACTIVE reservation with a still-future window as ACTIVE', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const doc = makeReservation({ startAt: future, endAt: new Date(future.getTime() + 60 * 60 * 1000) });
    expect(toReservationResult(doc).status).toBe(ReservationStatus.ACTIVE);
  });

  it('does not reclassify a past-window reservation that is already CANCELLED or FULFILLED', () => {
    const past = { startAt: new Date('2020-01-01T09:00:00Z'), endAt: new Date('2020-01-01T10:00:00Z') };
    expect(toReservationResult(makeReservation({ ...past, status: ReservationStatus.CANCELLED })).status).toBe(ReservationStatus.CANCELLED);
    expect(toReservationResult(makeReservation({ ...past, status: ReservationStatus.FULFILLED })).status).toBe(ReservationStatus.FULFILLED);
  });

  it('does not mutate the stored document, only the returned view', () => {
    const doc = makeReservation({ startAt: new Date('2020-01-01T09:00:00Z'), endAt: new Date('2020-01-01T10:00:00Z') });
    toReservationResult(doc);
    expect(doc.status).toBe(ReservationStatus.ACTIVE);
  });
});
