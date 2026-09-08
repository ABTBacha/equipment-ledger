import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Worker } from '../schemas/worker.schema';
import { Reservation } from '../schemas/reservation.schema';
import { AssetsService, AssetSummary } from '../assets/assets.service';
import { MovementsService } from '../movements/movements.service';
import { ReservationResult, RawReservationDoc, toReservationResult } from '../reservations/reservation-result';

export interface WorkerSummary {
  _id: string;
  name: string;
  certifications: { code: string; expiresAt: Date }[];
  currentlyHolding: AssetSummary[];
  reservations: ReservationResult[];
}

@Injectable()
export class WorkersService {
  constructor(
    @InjectModel(Worker.name) private readonly workerModel: Model<Worker>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    private readonly assetsService: AssetsService,
    private readonly movementsService: MovementsService,
  ) {}

  async findAll(): Promise<Worker[]> {
    return this.workerModel.find({}).lean();
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
