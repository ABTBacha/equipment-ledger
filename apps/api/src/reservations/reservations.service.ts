import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AssetStatus, CancelReservationDto, CreateReservationDto, ReservationStatus } from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Reservation } from '../schemas/reservation.schema';
import { Movement } from '../schemas/movement.schema';
import { AssetLock } from '../schemas/asset-lock.schema';
import { intervalsOverlap } from '../domain/intervals';
import { withIdempotency, replayOrThrow } from '../domain/idempotency';
import { withRetries } from '../domain/retry';
import { ReservationResult, RawReservationDoc, toReservationResult } from './reservation-result';

@Injectable()
export class ReservationsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<Asset>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    @InjectModel(Movement.name) private readonly movementModel: Model<Movement>,
    @InjectModel(AssetLock.name) private readonly assetLockModel: Model<AssetLock>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async reserve(dto: CreateReservationDto): Promise<ReservationResult> {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (endAt.getTime() <= startAt.getTime()) {
      throw new UnprocessableEntityException('endAt must be after startAt');
    }
    if (startAt.getTime() < Date.now()) {
      throw new UnprocessableEntityException('startAt cannot be in the past');
    }

    const { result } = await withIdempotency(this.reservationModel, dto.idempotencyKey, () =>
      withRetries(() => this.executeReserve(dto, startAt, endAt)),
    );
    return toReservationResult(result);
  }

  /**
   * Cancelling is a soft transition, never a delete: the row stays in the collection with
   * status CANCELLED and its reason, so "what was booked and then called off" remains
   * answerable — the same principle as correcting a movement rather than editing it.
   *
   * The window is freed as a side effect: overlap detection in `executeReserve` only ever
   * considers status ACTIVE reservations, so nothing else has to change.
   *
   * Concurrency needs no transaction here. This is a compare-and-set on a single document
   * (`status: ACTIVE` in the filter), so two simultaneous cancels can't both win — the loser
   * matches nothing and reports the conflict.
   */
  async cancel(id: string, dto: CancelReservationDto): Promise<ReservationResult> {
    // An id that isn't a valid ObjectId would make Mongoose throw a CastError (a 500) rather
    // than report the reservation as missing, which is what it actually is.
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }

    const cancelled = await this.reservationModel
      .findOneAndUpdate(
        // `endAt` is part of the filter because an ACTIVE reservation whose window has passed
        // reads as NOT_COLLECTED everywhere (see toReservationResult); cancelling one would
        // contradict what the caller was looking at.
        { _id: id, status: ReservationStatus.ACTIVE, endAt: { $gt: new Date() } },
        { $set: { status: ReservationStatus.CANCELLED, cancelReason: dto.reason ?? null } },
        { new: true },
      )
      .lean();

    if (cancelled) return toReservationResult(cancelled as unknown as RawReservationDoc);

    const existing = await this.reservationModel.findById(id).lean();
    if (!existing) throw new NotFoundException(`Reservation ${id} not found`);
    const current = toReservationResult(existing as unknown as RawReservationDoc);
    throw new ConflictException(`Reservation ${id} is not active (status ${current.status}) and cannot be cancelled`);
  }

  async findAll(): Promise<ReservationResult[]> {
    const docs = await this.reservationModel.find({}).lean();
    return (docs as unknown as RawReservationDoc[]).map((doc) => toReservationResult(doc));
  }

  private async executeReserve(dto: CreateReservationDto, startAt: Date, endAt: Date): Promise<RawReservationDoc> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const asset = await this.assetModel.findById(dto.assetId, null, { session });
        if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);
        if (asset.status === AssetStatus.OUT_OF_SERVICE) {
          // Not a replay candidate: this branch is about causality, not about whether
          // concurrent OUT_OF_SERVICE flips can happen (they can — see the AssetLock bump
          // below, which exists precisely to serialize against a concurrent
          // takeOutOfService()/return(outOfService) call). The point is that reserve()
          // itself can never be the one that causes the flip to OUT_OF_SERVICE — only
          // AssetsService.takeOutOfService/bringBackIntoService and
          // MovementsService.return(outOfService:true) write Asset.status — so there is
          // no "our own winner changed this" case for THIS call to replay here: whatever
          // set this status, it wasn't a duplicate submission of this reserve() request,
          // so this is a genuine business-rule rejection every time.
          throw new ConflictException(`Asset ${dto.assetId} is out of service and cannot be reserved`);
        }


        // Force serialization: bump a per-asset lock document nonce inside the
        // transaction so that two concurrent reserve() calls for the same asset can
        // never both proceed past this point without one aborting with a write
        // conflict (TransientTransactionError), which withRetries then retries from
        // scratch with a fresh read of activeReservations below.
        await this.assetLockModel.findOneAndUpdate(
          { _id: dto.assetId },
          { $inc: { nonce: 1 } },
          { session, upsert: true, new: true },
        );

        // The mirror of the reservation check issue() makes: an asset promised to somebody
        // until 17:00 cannot also be booked from 14:00. Read after the lock bump above, so a
        // concurrent issue() for this asset — which bumps the same document — conflicts
        // instead of committing in the gap between this read and this transaction's commit.
        if (asset.status === AssetStatus.ISSUED && asset.currentMovementId) {
          const openIssue = await this.movementModel.findById(asset.currentMovementId, null, { session }).lean();
          if (openIssue?.dueAt && openIssue.dueAt.getTime() > startAt.getTime()) {
            throw new ConflictException({
              statusCode: 409,
              error: 'Conflict',
              code: 'ASSET_OUT_UNTIL',
              message:
                `Asset ${dto.assetId} is out with ${asset.currentHolderId} until ` +
                `${openIssue.dueAt.toISOString()}, so it cannot be reserved from ` +
                `${startAt.toISOString()}`,
              conflict: {
                workerId: asset.currentHolderId,
                dueAt: openIssue.dueAt.toISOString(),
              },
            });
          }
        }

        const activeReservations = await this.reservationModel
          .find({ assetId: dto.assetId, status: ReservationStatus.ACTIVE }, null, { session })
          .lean();

        const conflicting = activeReservations.find((r) => intervalsOverlap(startAt, endAt, r.startAt, r.endAt));
        if (conflicting) {
          // A double-click (two concurrent reserve() calls with the SAME idempotencyKey
          // and the SAME window) can land here: the loser's retry, after the winner's
          // transaction has committed, re-reads activeReservations and finds the
          // winner's own just-inserted reservation — which trivially "overlaps" itself
          // (intervalsOverlap(x, x) is true for identical windows). That is not a
          // genuine conflict, it's our own request's earlier winner, so check for a
          // reservation carrying this exact idempotencyKey and replay it instead of
          // throwing. This lookup is deliberately NOT scoped to the current
          // transaction's session: this transaction's snapshot may have been
          // established before the winner committed, so a session-scoped read here
          // could still see nothing even though the winner has already committed.
          return replayOrThrow<RawReservationDoc>(
            this.reservationModel,
            dto.idempotencyKey,
            () =>
              // The window is carried as structured `conflict` data, not only interpolated
              // into `message`, so the browser can render it in the viewer's own timezone.
              // `message` keeps the ISO form as the fallback for non-browser API clients.
              new ConflictException({
                statusCode: 409,
                error: 'Conflict',
                code: 'RESERVATION_OVERLAP',
                message: `Overlaps an existing reservation from ${conflicting.startAt.toISOString()} to ${conflicting.endAt.toISOString()}`,
                conflict: {
                  startAt: conflicting.startAt.toISOString(),
                  endAt: conflicting.endAt.toISOString(),
                },
              }),
          );
        }

        const [reservation] = await this.reservationModel.create(
          [{ assetId: dto.assetId, workerId: dto.workerId, startAt, endAt, idempotencyKey: dto.idempotencyKey }],
          { session },
        );

        return reservation;
      });
    } finally {
      await session.endSession();
    }
  }
}
