import { Module } from '@nestjs/common';
import { CustomerDataModule } from '../customer-data/customer-data.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentExpressController } from './payment-express.controller';
import { PaymentExpressService } from './payment-express.service';

@Module({
  imports: [PaymentsModule, CustomerDataModule],
  controllers: [PaymentExpressController],
  providers: [PaymentExpressService],
})
export class PaymentExpressModule {}
