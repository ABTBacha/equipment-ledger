import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
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
}

export const ReservationSchema = SchemaFactory.createForClass(Reservation);
