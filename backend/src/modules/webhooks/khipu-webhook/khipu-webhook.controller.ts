import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { KhipuWebhookPayload } from '../../khipu/interfaces/khipu-webhook.interface';
import { PaymentsService } from '../../payments/payments.service';

@Controller('webhooks/khipu')
export class KhipuWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('mock-paid/:paymentId')
  markMockPaymentAsPaid(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    return this.paymentsService.markPaymentAsPaidFromMock(paymentId);
  }

  @Post('real')
  async receiveRealKhipuWebhook(@Body() body: KhipuWebhookPayload) {
    if (!this.isPaidWebhook(body)) {
      return {
        received: true,
        processed: false,
        message: 'Webhook recibido, pero no corresponde a un pago confirmado.',
      };
    }

    if (!body.transaction_id) {
      throw new BadRequestException('Webhook de Khipu sin transaction_id.');
    }

    if (!body.payment_id) {
      throw new BadRequestException('Webhook de Khipu sin payment_id.');
    }

    const amount = Number(body.amount ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Webhook de Khipu con monto inválido.');
    }

    const currency = body.currency ?? 'CLP';

    const result = await this.paymentsService.markPaymentAsPaidFromKhipuWebhook(
      {
        localPaymentId: body.transaction_id,
        khipuPaymentId: body.payment_id,
        amount,
        currency,
        payload: body,
      },
    );

    return {
      received: true,
      processed: true,
      ...result,
    };
  }

  private isPaidWebhook(body: KhipuWebhookPayload): boolean {
    const status =
      typeof body.status === 'string' ? body.status.toLowerCase() : null;

    if (status === 'done') {
      return true;
    }

    return typeof body.conciliation_date === 'string';
  }
}
