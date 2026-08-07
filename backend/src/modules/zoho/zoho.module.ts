import { Module } from '@nestjs/common';
import { ZohoAuthService } from './zoho-auth.service';
import { ZohoBooksService } from './zoho-books.service';
import { ZohoCustomerPaymentsService } from './zoho-customer-payments.service';

@Module({
  providers: [ZohoAuthService, ZohoBooksService, ZohoCustomerPaymentsService],
  exports: [ZohoAuthService, ZohoBooksService, ZohoCustomerPaymentsService],
})
export class ZohoModule {}
