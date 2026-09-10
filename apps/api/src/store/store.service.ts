import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Movement } from '../schemas/movement.schema';
import { AssetReplayState, replayStoreState, resolveEffectiveMovements, toRawMovement } from '../domain/replay';

@Injectable()
export class StoreService {
  constructor(@InjectModel(Movement.name) private readonly movementModel: Model<Movement>) {}

  async getStoreAsOf(asOf: Date): Promise<Map<string, AssetReplayState>> {
    const docs = await this.movementModel.find({}).lean();
    const raw = docs.map(toRawMovement);
    const effective = resolveEffectiveMovements(raw);
    return replayStoreState(effective, asOf);
  }

  /**
   * Overdue is relative to the instant being asked about, not to now: "was the gas
   * detector overdue at 14:20 last Tuesday" has to compare its due-back time against
   * 14:20 last Tuesday. Same reason the dashboard compares against the present — one
   * rule, two instants — which is why it lives next to the replay rather than in a
   * screen.
   */
  isOverdueAsOf(state: AssetReplayState, asOf: Date): boolean {
    return state.status === 'ISSUED' && state.dueAt !== null && state.dueAt.getTime() < asOf.getTime();
  }
}
