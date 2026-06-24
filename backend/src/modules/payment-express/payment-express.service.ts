import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentStatus, PaymentMode } from '@prisma/client';
import { isValidRut, normalizeRut } from '../../common/utils/rut.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentExpressRutDto } from './dto/payment-express-rut.dto';

@Injectable()
export class PaymentExpressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async getSummary(paymentExpressRutDto: PaymentExpressRutDto) {
    const normalizedRut = this.validateAndNormalizeRut(
      paymentExpressRutDto.rut,
    );

    const customer = await this.prisma.customer.findUnique({
      where: {
        rutNormalized: normalizedRut,
      },
      select: {
        id: true,
        documents: {
          where: {
            status: {
              in: [
                DocumentStatus.PENDING,
                DocumentStatus.OVERDUE,
                DocumentStatus.PARTIALLY_PAID,
              ],
            },
            outstandingAmount: {
              gt: 0,
            },
          },
          select: {
            outstandingAmount: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(
        'No se encontró deuda asociada al RUT ingresado.',
      );
    }

    const totalDebt = customer.documents.reduce(
      (sum, document) => sum + document.outstandingAmount,
      0,
    );

    return {
      message: 'Resumen de deuda express obtenido correctamente.',
      totalDebt,
      currency: 'CLP',
      canPay: totalDebt > 0,
    };
  }

  async payTotal(paymentExpressRutDto: PaymentExpressRutDto) {
    const normalizedRut = this.validateAndNormalizeRut(
      paymentExpressRutDto.rut,
    );

    const customer = await this.prisma.customer.findUnique({
      where: {
        rutNormalized: normalizedRut,
      },
      select: {
        id: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(
        'No se encontró deuda asociada al RUT ingresado.',
      );
    }

    const paymentResult = await this.paymentsService.createPayment({
      customerId: customer.id,
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

  private validateAndNormalizeRut(rut: string): string {
    const normalizedRut = normalizeRut(rut);

    if (!isValidRut(normalizedRut)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }

    return normalizedRut;
  }
}
