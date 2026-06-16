import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { DebtsService } from './debts.service';

@Controller('customers/:customerId')
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Get('debt-summary')
  getDebtSummaryByCustomerId(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.debtsService.getDebtSummaryByCustomerId(customerId);
  }
}
