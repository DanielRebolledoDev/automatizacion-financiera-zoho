import { Module } from '@nestjs/common';
import { KhipuModule } from '../khipu/khipu.module';
import { ZohoModule } from '../zoho/zoho.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [KhipuModule, ZohoModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
