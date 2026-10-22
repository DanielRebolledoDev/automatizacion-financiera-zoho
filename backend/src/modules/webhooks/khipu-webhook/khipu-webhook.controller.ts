import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { KhipuService } from '../../khipu/khipu.service';
import { PaymentsService } from '../../payments/payments.service';
import { verifyKhipuSignature } from '../khipu-webhook/khipu-signature.util';

interface RawWebhookRequest {
  rawBody?: Buffer;
}

@Controller('webhooks/khipu')
export class KhipuWebhookController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly khipuService: KhipuService,
    private readonly configService: ConfigService,
  ) {}

  @Post('mock-paid/:paymentId')
  markMockPaymentAsPaid(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    // La restricción se aplica en PaymentsService para cubrir todos sus callers.
    return this.paymentsService.markPaymentAsPaidFromMock(paymentId);
  }

  @Post('real')
  @HttpCode(200)
  async receiveRealKhipuWebhook(
    @Req() request: RawWebhookRequest,
    @Headers('x-khipu-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    // La ruta real siempre exige firma. El flag antiguo no permite omitirla.
    const secret = this.configService
      .get<string>('KHIPU_WEBHOOK_SECRET')
      ?.trim();

    if (!secret) {
      throw new ServiceUnavailableException(
        'Falta configurar el secreto de verificación del webhook de Khipu.',
      );
    }

    if (!Buffer.isBuffer(request.rawBody)) {
      throw new ServiceUnavailableException(
        'No está disponible el cuerpo original del webhook.',
      );
    }

    if (
      typeof signature !== 'string' ||
      !verifyKhipuSignature(request.rawBody, signature, secret)
    ) {
      throw new UnauthorizedException(
        'Firma de Khipu inválida o fuera de plazo.',
      );
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('El webhook debe contener un objeto JSON.');
    }

    const payload = body as Record<string, unknown>;
    const paymentId = payload.transaction_id;
    const khipuPaymentId = payload.payment_id;

    if (typeof paymentId !== 'string' || !isUUID(paymentId)) {
      throw new BadRequestException('Webhook sin transaction_id local válido.');
    }
    if (
      typeof khipuPaymentId !== 'string' ||
      !khipuPaymentId.trim() ||
      khipuPaymentId.startsWith('mock_')
    ) {
      throw new BadRequestException(
        'Webhook sin identificador real de Khipu válido.',
      );
    }

    const localResult =
      await this.paymentsService.findPaymentStatusById(paymentId);
    const payment = localResult.payment;

    if (payment.khipuPaymentId !== khipuPaymentId) {
      throw new BadRequestException(
        'El cobro informado no coincide con el pago local.',
      );
    }

    // Una repetición firmada y asociada al mismo cobro ya confirmado se reconoce
    // sin repetir documentos, eventos, intentos ni sincronización con Zoho.
    if (payment.status === 'PAID') {
      return {
        received: true,
        processed: true,
        alreadyProcessed: true,
        paymentId,
      };
    }

    // No tomamos status, conciliation_date, monto ni moneda del body como prueba
    // suficiente del pago. Obtenemos el estado desde la API autenticada de Khipu.
    const result = await this.khipuService.getPaymentById(khipuPaymentId);
    const confirmed = result.response;

    if (
      confirmed.payment_id !== khipuPaymentId ||
      confirmed.transaction_id !== paymentId
    ) {
      throw new BadRequestException(
        'La respuesta de Khipu no corresponde al pago local.',
      );
    }

    const amount = Number(confirmed.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount !== payment.amount) {
      throw new BadRequestException(
        'El monto confirmado por Khipu no coincide con el pago local.',
      );
    }
    if (confirmed.currency !== payment.currency) {
      throw new BadRequestException(
        'La moneda confirmada por Khipu no coincide con el pago local.',
      );
    }

    if (confirmed.status === 'pending' || confirmed.status === 'verifying') {
      return {
        received: true,
        processed: false,
        paymentId,
        message: 'Khipu todavía no confirma el pago como realizado.',
      };
    }
    if (confirmed.status !== 'done') {
      throw new ServiceUnavailableException(
        'Khipu respondió con un estado no reconocido.',
      );
    }

    const processed =
      await this.paymentsService.markPaymentAsPaidFromKhipuWebhook({
        localPaymentId: paymentId,
        khipuPaymentId,
        amount,
        currency: confirmed.currency,
        payload: confirmed,
      });

    return {
      received: true,
      processed: true,
      alreadyProcessed: processed.alreadyProcessed,
      paymentId,
    };
  }
}
