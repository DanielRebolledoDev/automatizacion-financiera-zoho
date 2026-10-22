import { Module } from '@nestjs/common';
import { KhipuModule } from '../khipu/khipu.module';
import { PaymentsModule } from '../payments/payments.module';
import { KhipuWebhookController } from './khipu-webhook/khipu-webhook.controller';

@Module({
  imports: [PaymentsModule, KhipuModule],
  controllers: [KhipuWebhookController],
})
export class WebhooksModule {}
