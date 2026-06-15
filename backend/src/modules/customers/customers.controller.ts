import { Body, Controller, Post } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { ExpressSearchCustomerDto } from './dto/express-search-customer.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post('express-search')
  expressSearch(@Body() expressSearchCustomerDto: ExpressSearchCustomerDto) {
    return this.customersService.expressSearch(expressSearchCustomerDto);
  }
}
