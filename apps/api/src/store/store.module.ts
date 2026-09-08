import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Movement.name, schema: MovementSchema }])],
  providers: [StoreService],
  controllers: [StoreController],
  exports: [StoreService],
})
export class StoreModule {}
