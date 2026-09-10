import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { ReservationStatus } from '@equipment-ledger/shared';

@Schema({ collection: 'reservations' })
export class Reservation {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  assetId!: string;

  @Prop({ type: String, required: true })
  workerId!: string;

  @Prop({ type: Date, required: true })
  startAt!: Date;

  @Prop({ type: Date, required: true })
  endAt!: Date;

  @Prop({ type: String, enum: ReservationStatus, default: ReservationStatus.ACTIVE })
  status!: ReservationStatus;

  @Prop({ type: String, required: true, unique: true })
  idempotencyKey!: string;

  @Prop({ type: String, default: null })
  cancelReason!: string | null;

  /**
   * The ISSUE that collected this booking, set when it is fulfilled. Read back to answer
   * whether the collecting loan is still open, which is what separates a booking that was
   * honoured from one that is OVERDUE. The movement carries the same link the other way.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Movement', default: null })
  fulfilledByMovementId!: Types.ObjectId | null;
}

export const ReservationSchema = SchemaFactory.createForClass(Reservation);
