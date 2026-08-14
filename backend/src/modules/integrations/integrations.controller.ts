import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { ZohoDebtByRutTestDto } from './dto/zoho-debt-by-rut-test.dto';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('status')
  getStatus() {
    return this.integrationsService.getStatus();
  }

  @Get('zoho/auth-test')
  testZohoAuth() {
    return this.integrationsService.testZohoAuth();
  }

  @Get('zoho/organizations')
  listZohoOrganizations() {
    return this.integrationsService.listZohoOrganizations();
  }

  @Get('zoho/configured-organization')
  getConfiguredZohoOrganization() {
    return this.integrationsService.getConfiguredZohoOrganization();
  }

  @Get('zoho/unpaid-invoices-test')
  listZohoUnpaidInvoicesTest() {
    return this.integrationsService.listZohoUnpaidInvoicesTest();
  }

  @Get('zoho/unpaid-invoices-debug')
  listZohoUnpaidInvoicesDebug() {
    return this.integrationsService.listZohoUnpaidInvoicesDebug();
  }

  @Post('zoho/debt-by-rut-test')
  findZohoDebtByRutTest(@Body() dto: ZohoDebtByRutTestDto) {
    return this.integrationsService.findZohoDebtByRutTest(dto);
  }

  @Post('zoho/contact-first-debt-by-rut-test')
  findZohoContactFirstDebtByRutTest(@Body() dto: ZohoDebtByRutTestDto) {
    return this.integrationsService.findZohoContactFirstDebtByRutTest(dto);
  }

  @Post('zoho/customer-payment-dry-run/:paymentId')
  buildZohoCustomerPaymentDryRun(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    return this.integrationsService.buildZohoCustomerPaymentDryRun(paymentId);
  }

  @Post('zoho/customer-payment-sync-test/:paymentId')
  syncZohoCustomerPaymentTest(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    return this.integrationsService.syncZohoCustomerPaymentTest(paymentId);
  }

  @Post('zoho/invoices-by-rut-debug')
  listZohoInvoicesByRutDebug(@Body() dto: ZohoDebtByRutTestDto) {
    return this.integrationsService.listZohoInvoicesByRutDebug(dto);
  }
}
