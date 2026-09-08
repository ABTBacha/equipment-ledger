import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AssetStatus, IssueMovementDto, MovementType, ReservationStatus } from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Worker } from '../schemas/worker.schema';
import { Movement } from '../schemas/movement.schema';
import { Reservation } from '../schemas/reservation.schema';
import { checkCertification } from '../domain/certification';
import { withIdempotency } from '../domain/idempotency';

export interface MovementResult {
  _id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  recordedAt: Date;
  idempotencyKey: string;
}

/**
 * The shape actually produced by `executeIssue` and by a raw `.lean()` read of a
 * Movement document — `_id` is a Mongoose ObjectId here, not yet normalized to a
 * string. Only `toMovementResult`'s return value may be typed `MovementResult`.
 */
interface RawMovementDoc {
  _id: Types.ObjectId | string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  recordedAt: Date;
  idempotencyKey: string;
}

@Injectable()
export class MovementsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<Asset>,
    @InjectModel(Worker.name) private readonly workerModel: Model<Worker>,
    @InjectModel(Movement.name) private readonly movementModel: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async issue(dto: IssueMovementDto): Promise<MovementResult> {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    const worker = await this.workerModel.findById(dto.workerId).lean();
    if (!worker) throw new NotFoundException(`Worker ${dto.workerId} not found`);
    const asset = await this.assetModel.findById(dto.assetId).lean();
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    const certCheck = checkCertification(worker, asset.requiresCertification, occurredAt);
    if (!certCheck.valid) {
      throw new UnprocessableEntityException(certCheck.reason);
    }

    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      this.withRetries(() => this.executeIssue(dto, occurredAt)),
    );
    return this.toMovementResult(result);
  }

  private toMovementResult(doc: RawMovementDoc): MovementResult {
    return {
      _id: doc._id.toString(),
      assetId: doc.assetId,
      workerId: doc.workerId,
      type: doc.type,
      occurredAt: doc.occurredAt,
      recordedAt: doc.recordedAt,
      idempotencyKey: doc.idempotencyKey,
    };
  }

  private async executeIssue(dto: IssueMovementDto, occurredAt: Date): Promise<RawMovementDoc> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const movementId = new Types.ObjectId();
        const updatedAsset = await this.assetModel.findOneAndUpdate(
          { _id: dto.assetId, status: AssetStatus.IN_STORE },
          {
            $set: {
              status: AssetStatus.ISSUED,
              currentHolderId: dto.workerId,
              currentMovementId: movementId.toString(),
              updatedAt: new Date(),
            },
          },
          { session, new: true },
        );
        if (!updatedAsset) {
          // Another request may have won the CAS a moment ago carrying the exact same
          // idempotencyKey (e.g. a double-click submitting the same request twice). That
          // is not a genuine conflict — it's the same logical submission — so replay its
          // result instead of rejecting it. This lookup is deliberately NOT scoped to the
          // current transaction's session: our transaction's snapshot may have been
          // established before the winner committed, so a session-scoped read here could
          // still see nothing even though the winner has already committed.
          const existingMovement = await this.movementModel.findOne({ idempotencyKey: dto.idempotencyKey }).lean();
          if (existingMovement) {
            return existingMovement as RawMovementDoc;
          }
          throw new ConflictException(`Asset ${dto.assetId} is not available to issue`);
        }

        const [movement] = await this.movementModel.create(
          [
            {
              _id: movementId,
              assetId: dto.assetId,
              workerId: dto.workerId,
              type: MovementType.ISSUE,
              occurredAt,
              recordedAt: new Date(),
              idempotencyKey: dto.idempotencyKey,
              correctionOf: null,
              correctedBy: null,
              reason: null,
            },
          ],
          { session },
        );

        if (dto.reservationId) {
          await this.reservationModel.findOneAndUpdate(
            { _id: dto.reservationId, status: ReservationStatus.ACTIVE },
            { $set: { status: ReservationStatus.FULFILLED } },
            { session },
          );
        }

        return movement;
      });
    } finally {
      await session.endSession();
    }
  }

  private async withRetries<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (err?.hasErrorLabel?.('TransientTransactionError') && i < attempts - 1) continue;
        throw err;
      }
    }
    throw lastErr;
  }
}
