import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  CancelReservationDto,
  CancelReservationSchema,
  CreateReservationDto,
  CreateReservationSchema,
} from '@equipment-ledger/shared';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  reserve(@Body() body: unknown) {
    const dto: CreateReservationDto = CreateReservationSchema.parse(body);
    return this.reservationsService.reserve(dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: unknown) {
    const dto: CancelReservationDto = CancelReservationSchema.parse(body);
    return this.reservationsService.cancel(id, dto);
  }

  @Get()
  findAll() {
    return this.reservationsService.findAll();
  }
}
