import { Module } from '@nestjs/common';
import { ZohoAuthService } from './zoho-auth.service';
import { ZohoBooksService } from './zoho-books.service';

@Module({
  providers: [ZohoAuthService, ZohoBooksService],
  exports: [ZohoAuthService, ZohoBooksService],
})
export class ZohoModule {}
