import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus, BringBackIntoServiceDto, MovementType, ReservationStatus, TakeOutOfServiceDto } from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Movement } from '../schemas/movement.schema';
import { Reservation } from '../schemas/reservation.schema';
import { AssetLock } from '../schemas/asset-lock.schema';
import { withIdempotency, findReplayIfExists, replayOrThrow } from '../domain/idempotency';
import { withRetries } from '../domain/retry';
import { MovementResult, RawMovementDoc, toMovementResult } from '../movements/movement-result';
import { MovementsService } from '../movements/movements.service';

@Injectable()
export class AssetsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<Asset>,
    @InjectModel(Movement.name) private readonly movementModel: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    @InjectModel(AssetLock.name) private readonly assetLockModel: Model<AssetLock>,
    @InjectConnection() private readonly connection: Connection,
    private readonly movementsService: MovementsService,
  ) {}

  async takeOutOfService(assetId: string, dto: TakeOutOfServiceDto): Promise<MovementResult> {
    // Upfront replay check, BEFORE reading asset.status at all: a retry of an
    // already-succeeded call (sequential retry-after-success, or a genuine concurrent
    // double-click) must not branch on the asset's CURRENT status, because that status
    // may have already moved on as a direct result of the original request's own success
    // (e.g. IN_STORE -> OUT_OF_SERVICE). Branching on current status would send a retry
    // down a different branch than the original request took (e.g. into the "already out
    // of service" rejection instead of replaying the original success). Checking here,
    // before any branching, handles both cases uniformly regardless of which branch the
    // original request took.
    const existingMovement = await findReplayIfExists<RawMovementDoc>(this.movementModel, dto.idempotencyKey);
    if (existingMovement) {
      return toMovementResult(existingMovement);
    }

    const asset = await this.assetModel.findById(assetId).lean();
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    if (asset.status === AssetStatus.ISSUED) {
      return this.movementsService.return({
        assetId,
        workerId: asset.currentHolderId!,
        occurredAt: dto.occurredAt,
        idempotencyKey: dto.idempotencyKey,
        outOfService: true,
      });
    }

    if (asset.status === AssetStatus.OUT_OF_SERVICE) {
      throw new ConflictException(`Asset ${assetId} is already out of service`);
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      withRetries(() => this.executeTakeOutOfServiceInStore(assetId, occurredAt, dto.reason ?? null, dto.idempotencyKey)),
    );
    return toMovementResult(result);
  }

  private async executeTakeOutOfServiceInStore(
    assetId: string,
    occurredAt: Date,
    reason: string | null,
    idempotencyKey: string,
  ): Promise<RawMovementDoc> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const updated = await this.assetModel.findOneAndUpdate(
          { _id: assetId, status: AssetStatus.IN_STORE },
          { $set: { status: AssetStatus.OUT_OF_SERVICE, updatedAt: new Date() } },
          { session, new: true },
        );
        if (!updated) {
          // Same reasoning as executeIssue's CAS-miss branch: the CAS miss may be caused
          // by our own request's earlier winner (double-click with this exact
          // idempotencyKey) rather than a genuine conflict, so replay it instead of
          // throwing.
          return replayOrThrow<RawMovementDoc>(this.movementModel, idempotencyKey, () =>
            new ConflictException(`Asset ${assetId} is not available to take out of service`),
          );
        }

        // Force serialization against ReservationsService.reserve(): bump the same
        // per-asset AssetLock document reserve() bumps, inside this transaction. Taking
        // an asset out of service and reserving it currently share no document to
        // conflict on (this transaction only touches Asset/Movement/Reservation), so
        // without this, a concurrent reserve() and takeOutOfService() for the same asset
        // could interleave freely with no serialization at all — letting a new
        // reservation land on an asset that's simultaneously going out of service.
        // Bumping this shared document forces MongoDB's transaction-conflict detection
        // to abort-and-retry whichever of reserve()/takeOutOfService() commits second,
        // so the retrying one re-reads fresh state: if this transaction commits first,
        // reserve()'s retry re-reads asset.status and sees OUT_OF_SERVICE, correctly
        // rejecting; if reserve() commits first, this transaction's retry (below) re-reads
        // reservations and correctly cancels the one that just landed.
        await this.assetLockModel.findOneAndUpdate(
          { _id: assetId },
          { $inc: { nonce: 1 } },
          { session, upsert: true, new: true },
        );

        await this.reservationModel.updateMany(
          { assetId, status: ReservationStatus.ACTIVE },
          { $set: { status: ReservationStatus.CANCELLED, cancelReason: 'Asset taken out of service' } },
          { session },
        );

        const [movement] = await this.movementModel.create(
          [
            {
              assetId,
              workerId: null,
              type: MovementType.OUT_OF_SERVICE,
              occurredAt,
              recordedAt: new Date(),
              idempotencyKey,
              correctionOf: null,
              correctedBy: null,
              reason,
            },
          ],
          { session },
        );

        return movement;
      });
    } finally {
      await session.endSession();
    }
  }

  async bringBackIntoService(assetId: string, dto: BringBackIntoServiceDto): Promise<MovementResult> {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      withRetries(() => this.executeBringBackIntoService(assetId, occurredAt, dto.idempotencyKey)),
    );
    return toMovementResult(result);
  }

  private async executeBringBackIntoService(assetId: string, occurredAt: Date, idempotencyKey: string): Promise<RawMovementDoc> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const updated = await this.assetModel.findOneAndUpdate(
          { _id: assetId, status: AssetStatus.OUT_OF_SERVICE },
          { $set: { status: AssetStatus.IN_STORE, updatedAt: new Date() } },
          { session, new: true },
        );
        if (!updated) {
          // Same double-click reasoning as executeTakeOutOfServiceInStore's CAS-miss
          // branch above. Note: unlike takeOutOfService, this direction deliberately does
          // NOT bump the AssetLock document — nothing bad happens if a reserve() attempt
          // races against bringing an asset back into service; at worst a reservation
          // attempt gets a transient, harmless "out of service" rejection the client can
          // retry. The invariant that must be protected is only "no active reservation
          // survives alongside an out-of-service asset," which only the out-of-service
          // direction can violate.
          return replayOrThrow<RawMovementDoc>(this.movementModel, idempotencyKey, () =>
            new ConflictException(`Asset ${assetId} is not currently out of service`),
          );
        }

        const [movement] = await this.movementModel.create(
          [
            {
              assetId,
              workerId: null,
              type: MovementType.BACK_IN_SERVICE,
              occurredAt,
              recordedAt: new Date(),
              idempotencyKey,
              correctionOf: null,
              correctedBy: null,
              reason: null,
            },
          ],
          { session },
        );

        return movement;
      });
    } finally {
      await session.endSession();
    }
  }
}
