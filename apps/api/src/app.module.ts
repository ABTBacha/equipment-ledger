import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { MovementsModule } from './movements/movements.module';

@Module({
  imports: [DatabaseModule, MovementsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
