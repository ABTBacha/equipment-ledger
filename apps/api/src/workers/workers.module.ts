import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetsModule } from '../assets/assets.module';
import { WorkersService } from './workers.service';
import { WorkersController } from './workers.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Worker.name, schema: WorkerSchema },
      { name: Reservation.name, schema: ReservationSchema },
    ]),
    AssetsModule,
  ],
  providers: [WorkersService],
  controllers: [WorkersController],
  exports: [WorkersService],
})
export class WorkersModule {}
