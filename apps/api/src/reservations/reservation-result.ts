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
  cancelReason: string | null;
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
  cancelReason?: string | null;
}

export function toReservationResult(doc: RawReservationDoc): ReservationResult {
  // EXPIRED is a read-time computed view, not a stored status: a reservation that never
  // got fulfilled or cancelled and whose window has simply passed should read as EXPIRED
  // everywhere it's returned, without ever mutating the stored document (matching the
  // README's "computed lazily on read" description).
  const status = doc.status === ReservationStatus.ACTIVE && doc.endAt.getTime() < Date.now() ? ReservationStatus.EXPIRED : doc.status;
  return {
    _id: doc._id.toString(),
    assetId: doc.assetId,
    workerId: doc.workerId,
    startAt: doc.startAt,
    endAt: doc.endAt,
    status,
    idempotencyKey: doc.idempotencyKey,
    cancelReason: doc.cancelReason ?? null,
  };
}
