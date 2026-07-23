import { Controller, Get } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

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
}
