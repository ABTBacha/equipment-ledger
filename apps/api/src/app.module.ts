import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { MovementsModule } from './movements/movements.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({
  imports: [DatabaseModule, MovementsModule, ReservationsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
