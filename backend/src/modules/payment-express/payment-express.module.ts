import { Module } from '@nestjs/common';
import { PaymentExpressController } from './payment-express.controller';
import { PaymentExpressService } from './payment-express.service';

@Module({
  controllers: [PaymentExpressController],
  providers: [PaymentExpressService]
})
export class PaymentExpressModule {}
