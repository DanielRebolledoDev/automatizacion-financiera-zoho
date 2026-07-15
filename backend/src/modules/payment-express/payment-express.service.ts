import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMode } from '@prisma/client';
import { isValidRut, normalizeRut } from '../../common/utils/rut.util';
import { CUSTOMER_DATA_PROVIDER } from '../customer-data/customer-data.constants';
import type { CustomerDataProvider } from '../customer-data/interfaces/customer-data-provider.interface';
import { PaymentsService } from '../payments/payments.service';
import { PaymentExpressRutDto } from './dto/payment-express-rut.dto';

@Injectable()
export class PaymentExpressService {
  constructor(
    @Inject(CUSTOMER_DATA_PROVIDER)
    private readonly customerDataProvider: CustomerDataProvider,
    private readonly paymentsService: PaymentsService,
  ) {}

  async getSummary(paymentExpressRutDto: PaymentExpressRutDto) {
    const normalizedRut = this.validateAndNormalizeRut(
      paymentExpressRutDto.rut,
    );

    const summary =
      await this.customerDataProvider.getPaymentExpressSummaryByRut(
        normalizedRut,
      );

    if (!summary) {
      throw new NotFoundException(
        'No se encontró deuda asociada al RUT ingresado.',
      );
    }

    return {
      message: 'Resumen de deuda express obtenido correctamente.',
      totalDebt: summary.totalDebt,
      currency: summary.currency,
      canPay: summary.canPay,
    };
  }

  async payTotal(paymentExpressRutDto: PaymentExpressRutDto) {
    const normalizedRut = this.validateAndNormalizeRut(
      paymentExpressRutDto.rut,
    );

    const customerReference =
      await this.customerDataProvider.getCustomerReferenceByRut(normalizedRut);

    if (!customerReference) {
      throw new NotFoundException(
        'No se encontró deuda asociada al RUT ingresado.',
      );
    }

    const paymentResult = await this.paymentsService.createPayment({
      customerId: customerReference.customerId,
      mode: PaymentMode.TOTAL_DEBT,
    });

    return {
      message: paymentResult.reused
        ? 'Ya existe un pago express activo para esta deuda.'
        : 'Pago express generado correctamente.',
      reused: paymentResult.reused,
      payment: {
        id: paymentResult.payment.id,
        amount: paymentResult.payment.amount,
        currency: paymentResult.payment.currency,
        status: paymentResult.payment.status,
        paymentUrl: paymentResult.payment.khipuPaymentUrl,
        expiresAt: paymentResult.payment.expiresAt,
      },
    };
  }

  async getPaymentResult(paymentId: string) {
    const payment = await this.paymentsService.findPaymentStatusById(paymentId);

    return {
      message: 'Resultado de pago obtenido correctamente.',
      payment: {
        id: payment.payment.id,
        amount: payment.payment.amount,
        currency: payment.payment.currency,
        status: payment.payment.status,
        paymentUrl: payment.payment.khipuPaymentUrl,
        expiresAt: payment.payment.expiresAt,
        paidAt: payment.payment.paidAt,
        createdAt: payment.payment.createdAt,
        updatedAt: payment.payment.updatedAt,
      },
    };
  }

  private validateAndNormalizeRut(rut: string): string {
    const normalizedRut = normalizeRut(rut);

    if (!isValidRut(normalizedRut)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }

    return normalizedRut;
  }
}
