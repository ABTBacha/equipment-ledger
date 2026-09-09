import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { UpsertCertificationDto, UpsertCertificationSchema } from '@equipment-ledger/shared';
import { WorkersService } from './workers.service';

@Controller('workers')
export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  @Get()
  findAll() {
    return this.workersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workersService.findOne(id);
  }

  // PUT, because "the worker holds certification X until date D" is a statement of the final
  // state: sending it twice leaves the same result, whether it added or renewed.
  @Put(':id/certifications/:code')
  upsertCertification(@Param('id') id: string, @Param('code') code: string, @Body() body: unknown) {
    const dto: UpsertCertificationDto = UpsertCertificationSchema.parse({
      ...(body as Record<string, unknown>),
      code,
    });
    return this.workersService.upsertCertification(id, dto);
  }

  @Delete(':id/certifications/:code')
  removeCertification(@Param('id') id: string, @Param('code') code: string) {
    return this.workersService.removeCertification(id, code);
  }
}
