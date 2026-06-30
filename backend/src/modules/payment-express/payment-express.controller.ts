import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { PaymentExpressRutDto } from './dto/payment-express-rut.dto';
import { PaymentExpressService } from './payment-express.service';

@Controller('payment-express')
export class PaymentExpressController {
  constructor(private readonly paymentExpressService: PaymentExpressService) {}

  @Post('summary')
  getSummary(@Body() paymentExpressRutDto: PaymentExpressRutDto) {
    return this.paymentExpressService.getSummary(paymentExpressRutDto);
  }

  @Post('pay-total')
  payTotal(@Body() paymentExpressRutDto: PaymentExpressRutDto) {
    return this.paymentExpressService.payTotal(paymentExpressRutDto);
  }

  @Get('result/:paymentId')
  getPaymentResult(@Param('paymentId', new ParseUUIDPipe()) paymentId: string) {
    return this.paymentExpressService.getPaymentResult(paymentId);
  }
}
