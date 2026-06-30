import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PaymentsService } from '../../payments/payments.service';

@Controller('webhooks/khipu')
export class KhipuWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('mock-paid/:paymentId')
  markPaymentAsPaidFromMock(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    return this.paymentsService.markPaymentAsPaidFromMock(paymentId);
  }
}
