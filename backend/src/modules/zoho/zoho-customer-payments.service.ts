import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, ZohoSyncStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ZohoCreateCustomerPaymentPayload,
  ZohoCustomerPaymentDryRunResult,
  ZohoCustomerPaymentResponse,
  ZohoCustomerPaymentSyncResult,
} from './interfaces/zoho-customer-payment.interface';
import { ZohoBooksService } from './zoho-books.service';
import { normalizeRut } from '../../common/utils/rut.util';

@Injectable()
export class ZohoCustomerPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly zohoBooksService: ZohoBooksService,
  ) {}

  async buildCustomerPaymentDryRun(
    paymentId: string,
  ): Promise<ZohoCustomerPaymentDryRunResult> {
    const payload = await this.buildCustomerPaymentPayload(paymentId);

    await this.prisma.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        zohoSyncStatus: ZohoSyncStatus.DRY_RUN_READY,
        zohoSyncError: null,
      },
    });

    return {
      dryRun: true,
      sentToZoho: false,
      localPaymentId: paymentId,
      payload,
    };
  }

  async syncCustomerPaymentToZoho(
    paymentId: string,
  ): Promise<ZohoCustomerPaymentSyncResult> {
    const writeEnabled =
      this.configService.get<string>('ZOHO_WRITE_PAYMENTS_ENABLED') === 'true';

    const payload = await this.buildCustomerPaymentPayload(paymentId);

    if (!writeEnabled) {
      await this.prisma.payment.update({
        where: {
          id: paymentId,
        },
        data: {
          zohoSyncStatus: ZohoSyncStatus.DRY_RUN_READY,
          zohoSyncError:
            'Envío real a Zoho bloqueado porque ZOHO_WRITE_PAYMENTS_ENABLED no está en true.',
        },
      });

      return {
        dryRun: true,
        sentToZoho: false,
        localPaymentId: paymentId,
        zohoCustomerPaymentId: null,
        payload,
      };
    }

    const payment = await this.prisma.payment.findUnique({
      where: {
        id: paymentId,
      },
      select: {
        zohoCustomerPaymentId: true,
        zohoSyncStatus: true,
        customer: {
          select: {
            rut: true,
            rutNormalized: true,
            businessName: true,
          },
        },
      },
    });

    if (payment?.zohoCustomerPaymentId) {
      throw new BadRequestException(
        'Este pago ya fue sincronizado con Zoho anteriormente.',
      );
    }

    if (!payment) {
      throw new NotFoundException('No se encontró el pago solicitado.');
    }

    this.assertCustomerIsAllowedForZohoWrite(payment.customer.rutNormalized);

    try {
      const zohoResponse =
        await this.zohoBooksService.postToBooks<ZohoCustomerPaymentResponse>(
          '/customerpayments',
          payload,
        );

      const zohoCustomerPaymentId = zohoResponse.payment?.payment_id ?? null;

      if (!zohoCustomerPaymentId) {
        throw new ServiceUnavailableException({
          message: 'Zoho respondió correctamente, pero no devolvió payment_id.',
          response: zohoResponse,
        });
      }

      await this.prisma.payment.update({
        where: {
          id: paymentId,
        },
        data: {
          zohoCustomerPaymentId,
          zohoSyncedAt: new Date(),
          zohoSyncStatus: ZohoSyncStatus.SYNCED,
          zohoSyncError: null,
        },
      });

      return {
        dryRun: false,
        sentToZoho: true,
        localPaymentId: paymentId,
        zohoCustomerPaymentId,
        payload,
        zohoResponse,
      };
    } catch (error) {
      await this.prisma.payment.update({
        where: {
          id: paymentId,
        },
        data: {
          zohoSyncStatus: ZohoSyncStatus.FAILED,
          zohoSyncError:
            error instanceof Error
              ? error.message
              : 'Error desconocido al sincronizar pago con Zoho.',
        },
      });

      throw error;
    }
  }

  private async buildCustomerPaymentPayload(
    paymentId: string,
  ): Promise<ZohoCreateCustomerPaymentPayload> {
    const payment = await this.prisma.payment.findUnique({
      where: {
        id: paymentId,
      },
      include: {
        customer: true,
        documents: {
          include: {
            document: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('No se encontró el pago solicitado.');
    }

    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException(
        'Solo se puede registrar en Zoho un pago confirmado.',
      );
    }

    if (!payment.customer.zohoCustomerId) {
      throw new BadRequestException(
        'El cliente asociado no tiene zohoCustomerId.',
      );
    }

    if (payment.zohoCustomerPaymentId) {
      throw new BadRequestException(
        'Este pago ya tiene un zohoCustomerPaymentId asociado.',
      );
    }

    const invoices = payment.documents
      .filter((paymentDocument) => paymentDocument.document.zohoDocumentId)
      .map((paymentDocument) => ({
        invoice_id: paymentDocument.document.zohoDocumentId as string,
        amount_applied: paymentDocument.amount,
      }));

    if (invoices.length === 0) {
      throw new BadRequestException(
        'El pago no tiene documentos asociados con zohoDocumentId.',
      );
    }

    const amount = invoices.reduce(
      (sum, invoice) => sum + invoice.amount_applied,
      0,
    );

    if (amount <= 0) {
      throw new BadRequestException(
        'El monto a registrar en Zoho debe ser mayor a cero.',
      );
    }

    return {
      customer_id: payment.customer.zohoCustomerId,
      payment_mode:
        this.configService.get<string>('ZOHO_CUSTOMER_PAYMENT_MODE')?.trim() ||
        'banktransfer',
      amount,
      date: this.formatDate(payment.paidAt ?? new Date()),
      reference_number: payment.khipuPaymentId ?? payment.id,
      description: `Pago registrado desde Portal Pago Express. Pago local: ${payment.id}`,
      invoices,
    };
  }

  private assertCustomerIsAllowedForZohoWrite(rutNormalized: string): void {
    const rawAllowedRuts =
      this.configService.get<string>('ZOHO_PAYMENT_ALLOWED_RUTS')?.trim() ?? '';

    const allowedRuts = rawAllowedRuts
      .split(',')
      .map((rut) => rut.trim())
      .filter(Boolean)
      .map((rut) => normalizeRut(rut));

    if (allowedRuts.length === 0) {
      throw new BadRequestException(
        'No hay RUTs autorizados para escritura real en Zoho. Configura ZOHO_PAYMENT_ALLOWED_RUTS.',
      );
    }

    if (!allowedRuts.includes(rutNormalized)) {
      throw new BadRequestException(
        `El RUT ${rutNormalized} no está autorizado para escritura real en Zoho.`,
      );
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
