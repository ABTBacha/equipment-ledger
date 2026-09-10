import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { StoreService } from './store.service';

// `z.string().datetime()` rejects anything that isn't a well-formed ISO-8601 timestamp
// up front, so an unparseable `asOf` throws a ZodError here instead of reaching
// `new Date(asOf).toISOString()`, which throws a raw RangeError that Nest's default
// handler turns into a 500. The global ZodExceptionFilter (registered in main.ts) maps
// this to a clean 400, consistent with how the rest of the API validates input.
const AsOfQuerySchema = z.object({
  asOf: z.string().datetime().optional(),
});

@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get()
  async getStore(@Query() query: unknown) {
    const { asOf } = AsOfQuerySchema.parse(query);
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const state = await this.storeService.getStoreAsOf(asOfDate);
    // isOverdue is folded in here rather than left to the client, so a screen showing a
    // past instant and the dashboard showing now apply the same rule to the same field.
    const assets = Object.fromEntries(
      [...state.entries()].map(([assetId, assetState]) => [
        assetId,
        { ...assetState, isOverdue: this.storeService.isOverdueAsOf(assetState, asOfDate) },
      ]),
    );
    return { asOf: asOfDate.toISOString(), assets };
  }
}
