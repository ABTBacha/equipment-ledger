import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateReservationDto, CreateReservationSchema } from '@equipment-ledger/shared';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  reserve(@Body() body: unknown) {
    const dto: CreateReservationDto = CreateReservationSchema.parse(body);
    return this.reservationsService.reserve(dto);
  }

  @Get()
  findAll() {
    return this.reservationsService.findAll();
  }
}
