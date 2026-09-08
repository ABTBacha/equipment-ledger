import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'asset_locks', _id: false })
export class AssetLock {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, default: 0 })
  nonce!: number;
}

export const AssetLockSchema = SchemaFactory.createForClass(AssetLock);
