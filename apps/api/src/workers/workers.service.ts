import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
}
