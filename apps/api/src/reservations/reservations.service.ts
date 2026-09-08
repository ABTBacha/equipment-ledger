import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus, CreateReservationDto, ReservationStatus } from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Reservation } from '../schemas/reservation.schema';
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
          return replayOrThrow<RawReservationDoc>(this.reservationModel, dto.idempotencyKey, () =>
            new ConflictException(
              `Overlaps an existing reservation from ${conflicting.startAt.toISOString()} to ${conflicting.endAt.toISOString()}`,
            ),
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
