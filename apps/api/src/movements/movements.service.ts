import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AssetStatus, CorrectMovementDto, IssueMovementDto, MovementType, ReservationStatus, ReturnMovementDto } from '@equipment-ledger/shared';
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
  correctionOf: string | null;
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
  correctionOf: Types.ObjectId | string | null;
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

  /**
   * If a movement with this exact idempotencyKey already exists, replay it instead of
   * throwing — the "conflicting" state a guard just read may have been caused by our own
   * request's earlier winner (a concurrent duplicate submission), not a genuine business-rule
   * violation. This lookup is deliberately NOT scoped to the current transaction's session:
   * the read that triggered the guard may have been served from a snapshot that predates the
   * winner's commit, so a session-scoped read here could still see nothing even though the
   * winner has already committed.
   */
  private async replayOrThrow(idempotencyKey: string, makeError: () => Error): Promise<RawMovementDoc> {
    const existing = await this.movementModel.findOne({ idempotencyKey }).lean();
    if (existing) {
      return existing as RawMovementDoc;
    }
    throw makeError();
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
      correctionOf: doc.correctionOf ? doc.correctionOf.toString() : null,
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

  async return(dto: ReturnMovementDto): Promise<MovementResult> {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      this.withRetries(() => this.executeReturn(dto, occurredAt)),
    );
    return this.toMovementResult(result);
  }

  private async executeReturn(dto: ReturnMovementDto, occurredAt: Date): Promise<RawMovementDoc> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        // Cheap fast path, checked first on every attempt including retries after an abort: if
        // this exact idempotencyKey has already succeeded, replay it instead of re-evaluating
        // business rules against the now-already-changed state. This alone is NOT sufficient,
        // though: the winner can commit in the gap between this read and the guard reads
        // below, so every state-comparison guard below also falls back to the same replay
        // check (via replayOrThrow) immediately before it would otherwise throw — see its
        // doc comment for why that's airtight rather than merely narrowing the race window.
        const existingMovement = await this.movementModel.findOne({ idempotencyKey: dto.idempotencyKey }).lean();
        if (existingMovement) {
          return existingMovement as RawMovementDoc;
        }

        const currentAsset = await this.assetModel.findById(dto.assetId, null, { session });
        if (!currentAsset) throw new NotFoundException(`Asset ${dto.assetId} not found`);
        if (currentAsset.status !== AssetStatus.ISSUED) {
          return this.replayOrThrow(dto.idempotencyKey, () =>
            new ConflictException(`Asset ${dto.assetId} is not currently issued (status: ${currentAsset.status})`),
          );
        }
        if (currentAsset.currentHolderId !== dto.workerId) {
          return this.replayOrThrow(dto.idempotencyKey, () =>
            new ConflictException(
              `Asset ${dto.assetId} is currently held by ${currentAsset.currentHolderId}, not ${dto.workerId}`,
            ),
          );
        }

        const openMovement = currentAsset.currentMovementId
          ? await this.movementModel.findById(currentAsset.currentMovementId, null, { session })
          : null;
        if (!openMovement) {
          return this.replayOrThrow(dto.idempotencyKey, () => new ConflictException(`No open movement found for asset ${dto.assetId}`));
        }
        if (occurredAt.getTime() < openMovement.occurredAt.getTime()) {
          throw new UnprocessableEntityException(
            `Return time ${occurredAt.toISOString()} is before the issue time ${openMovement.occurredAt.toISOString()}`,
          );
        }

        const newStatus = dto.outOfService ? AssetStatus.OUT_OF_SERVICE : AssetStatus.IN_STORE;
        const updatedAsset = await this.assetModel.findOneAndUpdate(
          { _id: dto.assetId, status: AssetStatus.ISSUED, currentHolderId: dto.workerId },
          { $set: { status: newStatus, currentHolderId: null, currentMovementId: null, updatedAt: new Date() } },
          { session, new: true },
        );
        if (!updatedAsset) {
          // Unreachable in the current read-then-CAS shape within a single attempt: anything
          // that gets this far already passed the same-snapshot guards above (which now each
          // fall back to replayOrThrow themselves), so a same-key winner would have already
          // been caught there. Retained for symmetry with executeIssue's CAS-miss branch and
          // as defense-in-depth if the guards above are ever reordered relative to this CAS.
          return this.replayOrThrow(
            dto.idempotencyKey,
            () => new ConflictException(`Asset ${dto.assetId} changed concurrently; return not applied`),
          );
        }

        const [returnMovement] = await this.movementModel.create(
          [
            {
              assetId: dto.assetId,
              workerId: dto.workerId,
              type: MovementType.RETURN,
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

        if (dto.outOfService) {
          await this.movementModel.create(
            [
              {
                assetId: dto.assetId,
                workerId: dto.workerId,
                type: MovementType.OUT_OF_SERVICE,
                occurredAt,
                recordedAt: new Date(),
                idempotencyKey: `${dto.idempotencyKey}-oos`,
                correctionOf: null,
                correctedBy: null,
                reason: 'Returned damaged',
              },
            ],
            { session },
          );
        }

        return returnMovement;
      });
    } finally {
      await session.endSession();
    }
  }

  async correct(movementId: string, dto: CorrectMovementDto): Promise<MovementResult> {
    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      this.withRetries(() => this.executeCorrect(movementId, dto)),
    );
    return this.toMovementResult(result);
  }

  private async executeCorrect(movementId: string, dto: CorrectMovementDto): Promise<RawMovementDoc> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        if (!Types.ObjectId.isValid(movementId)) {
          throw new NotFoundException(`Movement ${movementId} not found`);
        }
        const original = await this.movementModel.findById(movementId, null, { session });
        if (!original) throw new NotFoundException(`Movement ${movementId} not found`);

        // Claim the correction atomically: the filter requires correctedBy to still be
        // null at the moment of the write, so two concurrent corrections of the same
        // movement (different idempotencyKeys) can never both win — MongoDB serializes
        // concurrent writes to the same document, so exactly one findOneAndUpdate here
        // matches and the other necessarily observes correctedBy already set (either
        // immediately, or after its transaction is aborted with a write conflict and
        // retried by the driver). This mirrors the CAS pattern used for Asset.status in
        // executeIssue/executeReturn: no read-then-write window exists between "check
        // correctedBy is null" and "set it", because both happen in the single atomic
        // findOneAndUpdate below.
        const correctionId = new Types.ObjectId();
        const claimed = await this.movementModel.findOneAndUpdate(
          { _id: movementId, correctedBy: null },
          { $set: { correctedBy: correctionId } },
          { session, new: true },
        );
        if (!claimed) {
          // Either a genuinely different correction already claimed this movement, or this
          // is a double-click of the same submission racing itself — check before concluding
          // it's a real conflict, same reasoning as executeReturn's guard branches.
          return this.replayOrThrow(dto.idempotencyKey, () => new ConflictException(`Movement ${movementId} has already been corrected`));
        }

        const [correction] = await this.movementModel.create(
          [
            {
              _id: correctionId,
              assetId: original.assetId,
              workerId: original.workerId,
              type: original.type,
              occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : original.occurredAt,
              recordedAt: new Date(),
              idempotencyKey: dto.idempotencyKey,
              correctionOf: original._id,
              correctedBy: null,
              reason: dto.reason ?? null,
            },
          ],
          { session },
        );

        return correction;
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
