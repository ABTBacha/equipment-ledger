import { Controller, Get, Query } from '@nestjs/common';
import { StoreService } from './store.service';

@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get()
  async getStore(@Query('asOf') asOf?: string) {
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const state = await this.storeService.getStoreAsOf(asOfDate);
    return { asOf: asOfDate.toISOString(), assets: Object.fromEntries(state.entries()) };
  }
}
