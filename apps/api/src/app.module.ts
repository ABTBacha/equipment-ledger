import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { MovementsModule } from './movements/movements.module';
import { ReservationsModule } from './reservations/reservations.module';
import { AssetsModule } from './assets/assets.module';
import { WorkersModule } from './workers/workers.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [DatabaseModule, MovementsModule, ReservationsModule, AssetsModule, WorkersModule, StoreModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
