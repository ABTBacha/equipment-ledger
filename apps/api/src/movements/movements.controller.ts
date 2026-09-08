import { Body, Controller, Post } from '@nestjs/common';
import { IssueMovementDto, IssueMovementSchema } from '@equipment-ledger/shared';
import { MovementsService } from './movements.service';

@Controller('movements')
export class MovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  @Post('issue')
  issue(@Body() body: unknown) {
    const dto: IssueMovementDto = IssueMovementSchema.parse(body);
    return this.movementsService.issue(dto);
  }
}
