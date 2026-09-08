import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AssetStatus } from '@equipment-ledger/shared';

@Schema({ collection: 'assets', _id: false })
export class Asset {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  kind!: string;

  @Prop({ type: String, default: null })
  requiresCertification!: string | null;

  @Prop({ type: String, enum: AssetStatus, default: AssetStatus.IN_STORE })
  status!: AssetStatus;

  @Prop({ type: String, default: null })
  currentHolderId!: string | null;

  @Prop({ type: String, default: null })
  currentMovementId!: string | null;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt!: Date;
}

export const AssetSchema = SchemaFactory.createForClass(Asset);
