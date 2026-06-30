import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { KhipuWebhookController } from './khipu-webhook/khipu-webhook.controller';

@Module({
  imports: [PaymentsModule],
  controllers: [KhipuWebhookController],
})
export class WebhooksModule {}
