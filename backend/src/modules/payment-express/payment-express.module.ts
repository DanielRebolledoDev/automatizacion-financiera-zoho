import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentExpressController } from './payment-express.controller';
import { PaymentExpressService } from './payment-express.service';

@Module({
  imports: [PaymentsModule],
  controllers: [PaymentExpressController],
  providers: [PaymentExpressService],
})
export class PaymentExpressModule {}
