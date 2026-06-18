import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.createPayment(createPaymentDto);
  }

  @Get(':paymentId/status')
  findPaymentStatusById(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    return this.paymentsService.findPaymentStatusById(paymentId);
  }
}
