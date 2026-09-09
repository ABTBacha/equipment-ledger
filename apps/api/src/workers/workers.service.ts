import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpsertCertificationDto } from '@equipment-ledger/shared';
import { Worker } from '../schemas/worker.schema';
import { Reservation } from '../schemas/reservation.schema';
import { AssetsService, AssetSummary } from '../assets/assets.service';
import { ReservationResult, RawReservationDoc, toReservationResult } from '../reservations/reservation-result';

export interface WorkerListItem {
  _id: string;
  name: string;
  certifications: { code: string; expiresAt: Date }[];
  currentlyHolding: AssetSummary[];
}

export interface WorkerSummary extends WorkerListItem {
  reservations: ReservationResult[];
}

@Injectable()
export class WorkersService {
  constructor(
    @InjectModel(Worker.name) private readonly workerModel: Model<Worker>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    private readonly assetsService: AssetsService,
  ) {}

  async findAll(): Promise<WorkerListItem[]> {
    const workers = await this.workerModel.find({}).lean();
    // Single pass over the (already batch-computed) asset list rather than one
    // query per worker, mirroring AssetsService.findAll()'s aggregation approach.
    const allAssets = await this.assetsService.findAll();
    const holdingByWorker = new Map<string, AssetSummary[]>();
    for (const asset of allAssets) {
      if (!asset.currentHolderId) continue;
      const list = holdingByWorker.get(asset.currentHolderId);
      if (list) list.push(asset);
      else holdingByWorker.set(asset.currentHolderId, [asset]);
    }

    return workers.map((w) => ({
      _id: w._id,
      name: w.name,
      certifications: w.certifications,
      currentlyHolding: holdingByWorker.get(w._id) ?? [],
    }));
  }

  async findOne(id: string): Promise<WorkerSummary> {
    const worker = await this.workerModel.findById(id).lean();
    if (!worker) throw new NotFoundException(`Worker ${id} not found`);

    const allAssets = await this.assetsService.findAll();
    const currentlyHolding = allAssets.filter((a) => a.currentHolderId === id);
    const reservationDocs = await this.reservationModel.find({ workerId: id }).lean();
    const reservations = reservationDocs.map((d) => toReservationResult(d as RawReservationDoc));

    return { _id: worker._id, name: worker.name, certifications: worker.certifications, currentlyHolding, reservations };
  }

  /**
   * Adds a certification, or renews one the worker already holds — codes are unique per
   * worker, so `checkCertification`'s lookup-by-code stays unambiguous.
   *
   * Certifications are worker attributes, not ledger events, so this writes no movement.
   * Nothing here is retroactive either: a past ISSUE stands as the record of what happened
   * and a worker keeps any asset already in hand. Only the next issue sees the change.
   */
  async upsertCertification(id: string, dto: UpsertCertificationDto): Promise<WorkerSummary> {
    const expiresAt = new Date(dto.expiresAt);

    // Renew branch: the positional `$` operator updates the matched array element in place,
    // so the worker's other certifications and their order are untouched.
    const renewed = await this.workerModel.updateOne(
      { _id: id, 'certifications.code': dto.code },
      { $set: { 'certifications.$.expiresAt': expiresAt } },
    );

    if (renewed.matchedCount === 0) {
      // Add branch. The `$ne` guard is the compare-and-set: two concurrent adds of the same
      // code cannot both push, so the code can never appear twice.
      const added = await this.workerModel.updateOne(
        { _id: id, 'certifications.code': { $ne: dto.code } },
        { $push: { certifications: { code: dto.code, expiresAt } } },
      );

      if (added.matchedCount === 0) {
        // Either the worker doesn't exist, or someone else added this same code between our
        // two writes. Distinguish, and in the latter case fall back to renewing it.
        const exists = await this.workerModel.exists({ _id: id });
        if (!exists) throw new NotFoundException(`Worker ${id} not found`);
        await this.workerModel.updateOne(
          { _id: id, 'certifications.code': dto.code },
          { $set: { 'certifications.$.expiresAt': expiresAt } },
        );
      }
    }

    return this.findOne(id);
  }

  async removeCertification(id: string, code: string): Promise<WorkerSummary> {
    const removed = await this.workerModel.updateOne(
      { _id: id, 'certifications.code': code },
      { $pull: { certifications: { code } } },
    );

    if (removed.matchedCount === 0) {
      const exists = await this.workerModel.exists({ _id: id });
      throw new NotFoundException(
        exists ? `Worker ${id} does not hold certification ${code}` : `Worker ${id} not found`,
      );
    }

    return this.findOne(id);
  }
}
