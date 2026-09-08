import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: AssetLock.name, schema: AssetLockSchema },
    ]),
  ],
  providers: [ReservationsService],
  controllers: [ReservationsController],
  exports: [ReservationsService],
})
export class ReservationsModule {}
