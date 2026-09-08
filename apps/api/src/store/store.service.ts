import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Movement } from '../schemas/movement.schema';
import { AssetReplayState, RawMovement, replayStoreState, resolveEffectiveMovements } from '../domain/replay';

@Injectable()
export class StoreService {
  constructor(@InjectModel(Movement.name) private readonly movementModel: Model<Movement>) {}

  async getStoreAsOf(asOf: Date): Promise<Map<string, AssetReplayState>> {
    const docs = await this.movementModel.find({}).lean();
    const raw: RawMovement[] = docs.map((m) => ({
      id: String(m._id),
      assetId: m.assetId,
      workerId: m.workerId,
      type: m.type,
      occurredAt: m.occurredAt,
      recordedAt: m.recordedAt,
      correctionOf: m.correctionOf ? String(m.correctionOf) : null,
      correctedBy: m.correctedBy ? String(m.correctedBy) : null,
    }));
    const effective = resolveEffectiveMovements(raw);
    return replayStoreState(effective, asOf);
  }
}
