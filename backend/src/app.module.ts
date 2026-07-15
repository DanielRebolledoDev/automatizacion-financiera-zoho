import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validate } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DebtsModule } from './modules/debts/debts.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { KhipuModule } from './modules/khipu/khipu.module';
import { PaymentExpressModule } from './modules/payment-express/payment-express.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ZohoModule } from './modules/zoho/zoho.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { CustomerDataModule } from './modules/customer-data/customer-data.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 100,
        },
      ],
    }),
    PrismaModule,
    HealthModule,
    CustomersModule,
    DocumentsModule,
    DebtsModule,
    PaymentsModule,
    KhipuModule,
    PaymentExpressModule,
    WebhooksModule,
    ZohoModule,
    IntegrationsModule,
    CustomerDataModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
