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
  /** The issue that collected this booking, if it was collected. */
  fulfilledByMovementId: string | null;
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
  fulfilledByMovementId?: Types.ObjectId | string | null;
}

/**
 * Two of the five statuses are computed here rather than stored, because both are things the
 * clock makes true about a stored row and nothing would be there to write them:
 *
 * - NOT_COLLECTED: still ACTIVE, window gone. Nobody came for it.
 * - OVERDUE: collected, window gone, and the loan that collected it is still open. Nobody
 *   brought it back. Once it is back the booking reads FULFILLED again, however late the
 *   return was — that is history, not an outstanding problem.
 *
 * `openMovementIds` is the set of issue ids assets are currently out on, passed in by the
 * caller so a page of reservations costs one extra query rather than one per row. Omitting it
 * means "nothing is open", which is the right answer for a caller that has no asset state to
 * hand and only wants the stored view.
 */
export function toReservationResult(
  doc: RawReservationDoc,
  openMovementIds: ReadonlySet<string> = new Set(),
): ReservationResult {
  const windowPassed = doc.endAt.getTime() < Date.now();
  const collectingLoanStillOpen =
    doc.fulfilledByMovementId !== null &&
    doc.fulfilledByMovementId !== undefined &&
    openMovementIds.has(String(doc.fulfilledByMovementId));

  let status = doc.status;
  if (doc.status === ReservationStatus.ACTIVE && windowPassed) {
    status = ReservationStatus.NOT_COLLECTED;
  } else if (doc.status === ReservationStatus.FULFILLED && windowPassed && collectingLoanStillOpen) {
    status = ReservationStatus.OVERDUE;
  }
  return {
    _id: doc._id.toString(),
    assetId: doc.assetId,
    workerId: doc.workerId,
    startAt: doc.startAt,
    endAt: doc.endAt,
    status,
    idempotencyKey: doc.idempotencyKey,
    cancelReason: doc.cancelReason ?? null,
    fulfilledByMovementId: doc.fulfilledByMovementId ? String(doc.fulfilledByMovementId) : null,
  };
}
