import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  AssetStatus,
  CorrectMovementDto,
  IssueMovementDto,
  MIN_LOAN_BEFORE_RESERVATION_MS,
  MovementType,
  ReservationStatus,
  ReturnMovementDto,
} from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Worker } from '../schemas/worker.schema';
import { Movement } from '../schemas/movement.schema';
import { Reservation } from '../schemas/reservation.schema';
import { AssetLock } from '../schemas/asset-lock.schema';
import { checkCertification } from '../domain/certification';
import { intervalsOverlap } from '../domain/intervals';
import { withIdempotency, replayOrThrow } from '../domain/idempotency';
import { withRetries } from '../domain/retry';
import { resolveEffectiveMovements, toRawMovement } from '../domain/replay';
import { MovementResult, RawMovementDoc, toMovementResult } from './movement-result';

@Injectable()
export class MovementsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<Asset>,
    @InjectModel(Worker.name) private readonly workerModel: Model<Worker>,
    @InjectModel(Movement.name) private readonly movementModel: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    @InjectModel(AssetLock.name) private readonly assetLockModel: Model<AssetLock>,
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

    // A due-back time at or before the moment of issue promises nothing a keeper could
    // act on, and would read as instantly overdue. Checked here, before the transaction,
    // because it depends only on the request.
    const dueAt = new Date(dto.dueAt);
    if (dueAt.getTime() <= occurredAt.getTime()) {
      throw new UnprocessableEntityException(
        `Due back ${dueAt.toISOString()} is not after the issue at ${occurredAt.toISOString()}`,
      );
    }

    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      withRetries(() => this.executeIssue(dto, occurredAt, dueAt)),
    );
    return toMovementResult(result);
  }

  private async executeIssue(dto: IssueMovementDto, occurredAt: Date, dueAt: Date): Promise<RawMovementDoc> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const movementId = new Types.ObjectId();

        // Issuing now depends on reservations, and reserving depends on open issues, so the
        // two need something in common to conflict on. reserve() already bumps this document;
        // without issue() bumping it too, an issue could read reservations it has no write
        // overlap with and a reservation could land in the window that issue just claimed.
        // The CAS below is still what makes double-issue impossible — this is only what makes
        // the cross-entity checks serialisable.
        await this.assetLockModel.findOneAndUpdate(
          { _id: dto.assetId },
          { $inc: { nonce: 1 } },
          { session, upsert: true, new: true },
        );

        const activeReservations = await this.reservationModel
          .find({ assetId: dto.assetId, status: ReservationStatus.ACTIVE }, null, { session })
          .lean();

        const overlapping = activeReservations.filter((r) => intervalsOverlap(occurredAt, dueAt, r.startAt, r.endAt));
        const someoneElses = overlapping.find((r) => r.workerId !== dto.workerId);
        if (someoneElses) {
          return replayOrThrow(
            this.movementModel,
            dto.idempotencyKey,
            () =>
              new ConflictException({
                statusCode: 409,
                error: 'Conflict',
                code: 'RESERVED_FOR_ANOTHER_WORKER',
                message:
                  `Asset ${dto.assetId} is reserved for ${someoneElses.workerId} from ` +
                  `${someoneElses.startAt.toISOString()} to ${someoneElses.endAt.toISOString()}`,
                conflict: {
                  workerId: someoneElses.workerId,
                  startAt: someoneElses.startAt.toISOString(),
                  endAt: someoneElses.endAt.toISOString(),
                },
              }),
          );
        }

        // The reserving worker's own overlapping booking is not an obstacle — it is what they
        // came for. Collecting it pins the due-back time to the window: the booking already
        // states when the asset is free again, and a shorter loan would let this issue read as
        // returned on time while the window it belongs to is still open.
        const collectableReservation = overlapping.find((r) => r.workerId === dto.workerId) ?? null;
        if (collectableReservation) {
          if (dueAt.getTime() !== collectableReservation.endAt.getTime()) {
            throw new UnprocessableEntityException(
              `This issue collects a reservation ending ${collectableReservation.endAt.toISOString()}, ` +
                `so it is due back then, not ${dueAt.toISOString()}`,
            );
          }
        } else {
          // Nothing being collected, so this loan has to fit in the gap before the next
          // booking somebody else holds.
          const nextForSomeoneElse = activeReservations
            .filter((r) => r.workerId !== dto.workerId && r.startAt.getTime() >= occurredAt.getTime())
            .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];

          if (nextForSomeoneElse) {
            const gap = nextForSomeoneElse.startAt.getTime() - occurredAt.getTime();
            if (gap < MIN_LOAN_BEFORE_RESERVATION_MS) {
              return replayOrThrow(
                this.movementModel,
                dto.idempotencyKey,
                () =>
                  new ConflictException(
                    `Asset ${dto.assetId} is reserved for ${nextForSomeoneElse.workerId} from ` +
                      `${nextForSomeoneElse.startAt.toISOString()}, leaving less than ` +
                      `${Math.round(MIN_LOAN_BEFORE_RESERVATION_MS / 60000)} minutes to lend it`,
                  ),
              );
            }
            if (dueAt.getTime() > nextForSomeoneElse.startAt.getTime()) {
              throw new UnprocessableEntityException(
                `Asset ${dto.assetId} is reserved for ${nextForSomeoneElse.workerId} from ` +
                  `${nextForSomeoneElse.startAt.toISOString()}, so it cannot be due back ` +
                  `${dueAt.toISOString()}`,
              );
            }
          }
        }
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

        // The booking, if any, that this loan collects: the same worker, on this asset,
        // with a window the loan falls inside. Found rather than asserted by the caller,
        // so it is impossible to hand an asset to its reserving worker inside their own
        // window without the record saying that is what happened.
        const collected = collectableReservation;
        if (collected) {
          await this.reservationModel.findOneAndUpdate(
            { _id: collected._id, status: ReservationStatus.ACTIVE },
            { $set: { status: ReservationStatus.FULFILLED, fulfilledByMovementId: movementId } },
            { session },
          );
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
              dueAt,
              idempotencyKey: dto.idempotencyKey,
              correctionOf: null,
              correctedBy: null,
              reservationId: collected?._id ?? null,
              reason: null,
              loggedBy: dto.loggedBy ?? null,
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

  async return(dto: ReturnMovementDto): Promise<MovementResult> {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      withRetries(() => this.executeReturn(dto, occurredAt)),
    );
    return toMovementResult(result);
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
          return replayOrThrow(this.movementModel, dto.idempotencyKey, () =>
            new ConflictException(`Asset ${dto.assetId} is not currently issued (status: ${currentAsset.status})`),
          );
        }
        if (currentAsset.currentHolderId !== dto.workerId) {
          return replayOrThrow(this.movementModel, dto.idempotencyKey, () =>
            new ConflictException(
              `Asset ${dto.assetId} is currently held by ${currentAsset.currentHolderId}, not ${dto.workerId}`,
            ),
          );
        }

        const openMovement = currentAsset.currentMovementId
          ? await this.movementModel.findById(currentAsset.currentMovementId, null, { session })
          : null;
        if (!openMovement) {
          return replayOrThrow(this.movementModel, dto.idempotencyKey, () => new ConflictException(`No open movement found for asset ${dto.assetId}`));
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
          return replayOrThrow(
            this.movementModel,
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
              reservationId: null,
              reason: null,
              loggedBy: dto.loggedBy ?? null,
            },
          ],
          { session },
        );

        if (dto.outOfService) {
          // Same invariant AssetsService.executeTakeOutOfServiceInStore protects for the
          // IN_STORE path: an asset must never end up OUT_OF_SERVICE while an ACTIVE
          // reservation for it still stands, and a concurrent reserve() for this asset
          // must never be able to interleave past this transaction undetected. This
          // status flip is the ISSUED-path equivalent of that same transition, so it
          // needs the identical two pieces:
          //
          // 1. Cancel any standing ACTIVE reservations, atomically with the status flip.
          // 2. Bump the same per-asset AssetLock document reserve() bumps, so that a
          //    concurrent reserve() for this asset is forced to write-conflict against
          //    this transaction (both now write AssetLock) instead of being able to
          //    commit independently — without this, reserve() only reads Asset and never
          //    writes to it, so there would be nothing here for MongoDB's write-conflict
          //    detection to catch, and a reservation could land on an asset that just
          //    (from this transaction's perspective) went out of service.
          await this.assetLockModel.findOneAndUpdate(
            { _id: dto.assetId },
            { $inc: { nonce: 1 } },
            { session, upsert: true, new: true },
          );

          await this.reservationModel.updateMany(
            { assetId: dto.assetId, status: ReservationStatus.ACTIVE },
            { $set: { status: ReservationStatus.CANCELLED, cancelReason: 'Asset taken out of service' } },
            { session },
          );

          await this.movementModel.create(
            [
              {
                assetId: dto.assetId,
                workerId: dto.workerId,
                type: MovementType.OUT_OF_SERVICE,
                // Deliberately 1ms after the RETURN movement's occurredAt (not identical):
                // the replay algorithm's tiebreak for equal timestamps falls back to
                // lexicographic ObjectId comparison, which happens to produce the correct
                // order here today only incidentally. Giving OUT_OF_SERVICE a strictly later
                // timestamp makes "RETURN then OUT_OF_SERVICE" the correct replay order by
                // construction, not by luck.
                occurredAt: new Date(occurredAt.getTime() + 1),
                recordedAt: new Date(),
                idempotencyKey: `${dto.idempotencyKey}-oos`,
                correctionOf: null,
                correctedBy: null,
                reason: 'Returned damaged',
                loggedBy: dto.loggedBy ?? null,
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
      withRetries(() => this.executeCorrect(movementId, dto)),
    );
    return toMovementResult(result);
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

        if (dto.occurredAt) {
          await this.assertCorrectionKeepsLedgerOrder(original, new Date(dto.occurredAt), session);
        }

        // A correction can move the time of the issue, its due-back time, or both, so the
        // rule is checked against the pair that results — not against whichever half the
        // keeper happened to type. Same rule issue() enforces on the original write.
        const effectiveOccurredAt = dto.occurredAt ? new Date(dto.occurredAt) : original.occurredAt;
        const effectiveDueAt = dto.dueAt ? new Date(dto.dueAt) : original.dueAt ?? null;

        // A due date pinned by a booking cannot be moved one step later by correcting it:
        // the booking still states when the asset is free again. Correcting the time it
        // happened, or the reason, is unaffected.
        if (dto.dueAt && original.reservationId) {
          throw new UnprocessableEntityException(
            `This issue collected reservation ${String(original.reservationId)}, so its due-back time comes ` +
              'from that booking and cannot be corrected here. Cancel or re-book the reservation instead.',
          );
        }

        if (effectiveDueAt && effectiveDueAt.getTime() <= effectiveOccurredAt.getTime()) {
          throw new UnprocessableEntityException(
            `Due back ${effectiveDueAt.toISOString()} is not after the issue at ${effectiveOccurredAt.toISOString()}`,
          );
        }

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
          return replayOrThrow(this.movementModel, dto.idempotencyKey, () => new ConflictException(`Movement ${movementId} has already been corrected`));
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
              dueAt: dto.dueAt ? new Date(dto.dueAt) : original.dueAt ?? null,
              idempotencyKey: dto.idempotencyKey,
              correctionOf: original._id,
              correctedBy: null,
              reservationId: original.reservationId ?? null,
              reason: dto.reason ?? null,
              loggedBy: dto.loggedBy ?? null,
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

  /**
   * A correction may fix *when* something happened; it may not reorder the ledger.
   *
   * Live asset state (`assets.status`/`currentHolderId`) is a denormalisation of the
   * movement sequence, and `check-invariants` proves the two agree. A correction that
   * jumped a neighbouring movement would break that agreement without touching either
   * document: move a return back before the issue it closes and a replay says the asset
   * is still held while the asset document says it is in store. Nothing downstream can
   * tell which is right.
   *
   * So the rule is: the new time must stay strictly inside the gap its movement already
   * occupies — after the movement before it, before the movement after it. Keeping the
   * order means the denormalised state stays correct by construction, with nothing to
   * re-derive. The alternative (accept anything, then recompute current state) would let
   * a keeper's typo silently un-return an asset that is physically back on the shelf.
   *
   * Strictly inside, not at the boundary: two movements sharing a timestamp would leave
   * replay order decided by the ObjectId tiebreak, which is not something a keeper
   * editing a time should be able to make load-bearing.
   */
  private async assertCorrectionKeepsLedgerOrder(
    original: RawMovementDoc,
    newOccurredAt: Date,
    session: ClientSession,
  ): Promise<void> {
    if (newOccurredAt.getTime() > Date.now()) {
      throw new UnprocessableEntityException(
        `Cannot date this ${original.type} movement into the future (${newOccurredAt.toISOString()})`,
      );
    }

    const siblings = await this.movementModel.find({ assetId: original.assetId }, null, { session }).lean();
    const effective = resolveEffectiveMovements(
      siblings.map(toRawMovement),
    ).filter((m) => m.id !== String(original._id));

    const currentTime = original.occurredAt.getTime();
    const previous = effective
      .filter((m) => m.occurredAt.getTime() < currentTime)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    const next = effective
      .filter((m) => m.occurredAt.getTime() > currentTime)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];

    if (previous && newOccurredAt.getTime() <= previous.occurredAt.getTime()) {
      throw new UnprocessableEntityException(
        `Cannot move this ${original.type} to ${newOccurredAt.toISOString()}: it would land at or before the ` +
          `${previous.type} at ${previous.occurredAt.toISOString()} that precedes it. Corrections may change a ` +
          `movement's time, but not its place in the asset's history.`,
      );
    }
    if (next && newOccurredAt.getTime() >= next.occurredAt.getTime()) {
      throw new UnprocessableEntityException(
        `Cannot move this ${original.type} to ${newOccurredAt.toISOString()}: it would land at or after the ` +
          `${next.type} at ${next.occurredAt.toISOString()} that follows it. Corrections may change a ` +
          `movement's time, but not its place in the asset's history.`,
      );
    }
  }
}
