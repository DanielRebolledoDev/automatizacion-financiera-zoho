import { IntegrationsAdminGuard } from '../integrations/integrations-admin.guard';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { DebtsService } from './debts.service';

@Controller('customers/:customerId')
@UseGuards(IntegrationsAdminGuard)
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Get('debt-summary')
  getDebtSummaryByCustomerId(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.debtsService.getDebtSummaryByCustomerId(customerId);
  }
}
