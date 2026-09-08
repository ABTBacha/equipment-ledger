import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class Certification {
  @Prop({ type: String, required: true })
  code!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}
export const CertificationSchema = SchemaFactory.createForClass(Certification);

@Schema({ collection: 'workers', _id: false })
export class Worker {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: [CertificationSchema], default: [] })
  certifications!: Certification[];
}

export const WorkerSchema = SchemaFactory.createForClass(Worker);
