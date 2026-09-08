import { Body, Controller, Post } from '@nestjs/common';
import {
  IssueMovementDto,
  IssueMovementSchema,
  ReturnMovementDto,
  ReturnMovementSchema,
} from '@equipment-ledger/shared';
import { MovementsService } from './movements.service';

@Controller('movements')
export class MovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  @Post('issue')
  issue(@Body() body: unknown) {
    const dto: IssueMovementDto = IssueMovementSchema.parse(body);
    return this.movementsService.issue(dto);
  }

  @Post('return')
  returnMovement(@Body() body: unknown) {
    const dto: ReturnMovementDto = ReturnMovementSchema.parse(body);
    return this.movementsService.return(dto);
  }
}
