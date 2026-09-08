import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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

  @Get()
  findAll() {
    return this.assetsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assetsService.findOne(id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.assetsService.getHistory(id);
  }
}
