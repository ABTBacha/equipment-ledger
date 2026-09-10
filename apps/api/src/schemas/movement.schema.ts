import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { MovementType } from '@equipment-ledger/shared';

@Schema({ collection: 'movements' })
export class Movement {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  assetId!: string;

  @Prop({ type: String, default: null })
  workerId!: string | null;

  @Prop({ type: String, enum: MovementType, required: true })
  type!: MovementType;

  @Prop({ type: Date, required: true })
  occurredAt!: Date;

  @Prop({ type: Date, required: true })
  recordedAt!: Date;

  /**
   * When the asset is due back. Only ever set on an ISSUE movement — a return has
   * nothing to be due — and null when the keeper issued without naming a time, which
   * is why overdue is a derived reading rather than a stored status.
   */
  @Prop({ type: Date, default: null })
  dueAt!: Date | null;

  @Prop({ type: String, required: true, unique: true })
  idempotencyKey!: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: Movement.name, default: null })
  correctionOf!: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: Movement.name, default: null })
  correctedBy!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  reason!: string | null;

  @Prop({ type: String, default: null })
  loggedBy!: string | null;
}

export const MovementSchema = SchemaFactory.createForClass(Movement);
MovementSchema.index({ assetId: 1, occurredAt: 1 });
