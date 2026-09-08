import { Body, Controller, Param, Post } from '@nestjs/common';
import { BringBackIntoServiceSchema, TakeOutOfServiceSchema } from '@equipment-ledger/shared';
import { AssetsService } from './assets.service';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post(':id/out-of-service')
  takeOutOfService(@Param('id') id: string, @Body() body: unknown) {
    const dto = TakeOutOfServiceSchema.parse(body);
    return this.assetsService.takeOutOfService(id, dto);
  }

  @Post(':id/back-in-service')
  bringBackIntoService(@Param('id') id: string, @Body() body: unknown) {
    const dto = BringBackIntoServiceSchema.parse(body);
    return this.assetsService.bringBackIntoService(id, dto);
  }
}
