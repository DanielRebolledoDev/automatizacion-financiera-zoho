import { IntegrationsAdminGuard } from '../integrations/integrations-admin.guard';
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { ExpressSearchCustomerDto } from './dto/express-search-customer.dto';

@Controller('customers')
@UseGuards(IntegrationsAdminGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post('express-search')
  expressSearch(@Body() expressSearchCustomerDto: ExpressSearchCustomerDto) {
    return this.customersService.expressSearch(expressSearchCustomerDto);
  }
}
