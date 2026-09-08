import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AssetStatus, CreateReservationDto, ReservationStatus } from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Reservation } from '../schemas/reservation.schema';
import { AssetLock } from '../schemas/asset-lock.schema';
import { intervalsOverlap } from '../domain/intervals';
import { withIdempotency, replayOrThrow } from '../domain/idempotency';

export interface ReservationResult {
  _id: string;
  assetId: string;
  workerId: string;
  startAt: Date;
  endAt: Date;
  status: ReservationStatus;
  idempotencyKey: string;
}

/**
 * The shape actually produced by `executeReserve` and by a raw `.lean()` read of a
 * Reservation document — `_id` is a Mongoose ObjectId here, not yet normalized to a
 * string. Only `toReservationResult`'s return value may be typed `ReservationResult`.
 */
interface RawReservationDoc {
  _id: Types.ObjectId | string;
  assetId: string;
  workerId: string;
  startAt: Date;
  endAt: Date;
  status: ReservationStatus;
  idempotencyKey: string;
}

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
      this.withRetries(() => this.executeReserve(dto, startAt, endAt)),
    );
    return this.toReservationResult(result);
  }

  async findAll(): Promise<ReservationResult[]> {
    const docs = await this.reservationModel.find({}).lean();
    return (docs as unknown as RawReservationDoc[]).map((doc) => this.toReservationResult(doc));
  }

  private toReservationResult(doc: RawReservationDoc): ReservationResult {
    return {
      _id: doc._id.toString(),
      assetId: doc.assetId,
      workerId: doc.workerId,
      startAt: doc.startAt,
      endAt: doc.endAt,
      status: doc.status,
      idempotencyKey: doc.idempotencyKey,
    };
  }

  private async executeReserve(dto: CreateReservationDto, startAt: Date, endAt: Date): Promise<RawReservationDoc> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const asset = await this.assetModel.findById(dto.assetId, null, { session });
        if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);
        if (asset.status === AssetStatus.OUT_OF_SERVICE) {
          // Not a race artifact: an asset's status doesn't flip to OUT_OF_SERVICE as a
          // side effect of a concurrent reservation request, so there is no "our own
          // winner changed this" case to replay here — this is a genuine business-rule
          // rejection every time.
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
