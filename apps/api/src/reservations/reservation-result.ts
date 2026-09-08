import { Types } from 'mongoose';
import { ReservationStatus } from '@equipment-ledger/shared';

export interface ReservationResult {
  _id: string;
  assetId: string;
  workerId: string;
  startAt: Date;
  endAt: Date;
  status: ReservationStatus;
  idempotencyKey: string;
}

/**
 * The shape actually produced by `executeReserve` and by a raw `.lean()` read of a
 * Reservation document — `_id` is a Mongoose ObjectId here, not yet normalized to a
 * string. Only `toReservationResult`'s return value may be typed `ReservationResult`.
 */
export interface RawReservationDoc {
  _id: Types.ObjectId | string;
  assetId: string;
  workerId: string;
  startAt: Date;
  endAt: Date;
  status: ReservationStatus;
  idempotencyKey: string;
}

export function toReservationResult(doc: RawReservationDoc): ReservationResult {
  return {
    _id: doc._id.toString(),
    assetId: doc.assetId,
    workerId: doc.workerId,
    startAt: doc.startAt,
    endAt: doc.endAt,
    status: doc.status,
    idempotencyKey: doc.idempotencyKey,
  };
}
