import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from './schemas/asset.schema';
import { Worker, WorkerSchema } from './schemas/worker.schema';
import { Movement, MovementSchema } from './schemas/movement.schema';
import { Reservation, ReservationSchema } from './schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from './schemas/asset-lock.schema';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/equipment_ledger?replicaSet=rs0' }),
    }),
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Worker.name, schema: WorkerSchema },
      { name: Movement.name, schema: MovementSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: AssetLock.name, schema: AssetLockSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
