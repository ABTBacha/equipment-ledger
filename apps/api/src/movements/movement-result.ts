import { Types } from 'mongoose';
import { MovementType } from '@equipment-ledger/shared';

export interface MovementResult {
  _id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  recordedAt: Date;
  idempotencyKey: string;
  correctionOf: string | null;
}

/**
 * The shape actually produced by `executeIssue` and by a raw `.lean()` read of a
 * Movement document — `_id` is a Mongoose ObjectId here, not yet normalized to a
 * string. Only `toMovementResult`'s return value may be typed `MovementResult`.
 */
export interface RawMovementDoc {
  _id: Types.ObjectId | string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  recordedAt: Date;
  idempotencyKey: string;
  correctionOf: Types.ObjectId | string | null;
}

export function toMovementResult(doc: RawMovementDoc): MovementResult {
  return {
    _id: doc._id.toString(),
    assetId: doc.assetId,
    workerId: doc.workerId,
    type: doc.type,
    occurredAt: doc.occurredAt,
    recordedAt: doc.recordedAt,
    idempotencyKey: doc.idempotencyKey,
    correctionOf: doc.correctionOf ? doc.correctionOf.toString() : null,
  };
}
