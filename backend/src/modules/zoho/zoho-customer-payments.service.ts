import {
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentType,
  PaymentStatus,
  Prisma,
  ZohoSyncStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
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
    const { payment, payload } = await this.prepareCustomerPayment(paymentId);

    const saved = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.PAID,
        updatedAt: payment.updatedAt,
        zohoCustomerPaymentId: null,
        zohoSyncAttemptId: null,
        zohoSyncRemotePaymentId: null,
        zohoSyncStatus: {
          in: [ZohoSyncStatus.NOT_SYNCED, ZohoSyncStatus.DRY_RUN_READY],
        },
      },
      data: {
        zohoSyncStatus: ZohoSyncStatus.DRY_RUN_READY,
        zohoSyncError: null,
      },
    });

    if (saved.count !== 1) {
      throw new ConflictException(
        'El pago cambió durante el ensayo. Consulta su estado antes de continuar.',
      );
    }

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

    if (!writeEnabled) {
      const dryRun = await this.buildCustomerPaymentDryRun(paymentId);
      return { ...dryRun, zohoCustomerPaymentId: null };
    }

    const { payment, payload } = await this.prepareCustomerPayment(paymentId);
    if (!payment.khipuPaymentId || payment.khipuPaymentId.startsWith('mock_')) {
      throw new ForbiddenException(
        'No se permite enviar a Zoho un pago Mock o sin identificador real de Khipu.',
      );
    }
    this.assertCustomerIsAllowedForZohoWrite(payment.customer.rutNormalized);

    const attemptId = randomUUID();
    // Reserva persistente antes del POST. No mantenemos una transacción abierta
    // durante la llamada de red ni liberamos automáticamente reservas antiguas.
    const claimed = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.PAID,
        updatedAt: payment.updatedAt,
        zohoCustomerPaymentId: null,
        zohoSyncAttemptId: null,
        zohoSyncRemotePaymentId: null,
        zohoSyncStatus: {
          in: [ZohoSyncStatus.NOT_SYNCED, ZohoSyncStatus.DRY_RUN_READY],
        },
      },
      data: {
        zohoSyncStatus: ZohoSyncStatus.SENDING,
        zohoSyncAttemptId: attemptId,
        zohoSyncStartedAt: new Date(),
        zohoSyncPayload: JSON.parse(
          JSON.stringify(payload),
        ) as Prisma.InputJsonValue,
        zohoSyncError: null,
      },
    });

    if (claimed.count !== 1) {
      throw new ConflictException(
        'Otra solicitud tomó el pago o su estado cambió. No se realizó otro envío.',
      );
    }

    let remotePaymentId: string | null = null;
    try {
      const zohoResponse =
        await this.zohoBooksService.postToBooks<ZohoCustomerPaymentResponse>(
          '/customerpayments',
          payload,
        );

      const responseId = zohoResponse?.payment?.payment_id;
      if (typeof responseId === 'string' && responseId.trim()) {
        remotePaymentId = responseId.trim();
      }

      if (!zohoResponse || zohoResponse.code !== 0 || !remotePaymentId) {
        throw new ServiceUnavailableException(
          'Zoho no devolvió una confirmación válida con code 0 y payment_id.',
        );
      }

      const saved = await this.prisma.payment.updateMany({
        where: {
          id: paymentId,
          zohoSyncStatus: ZohoSyncStatus.SENDING,
          zohoSyncAttemptId: attemptId,
          zohoCustomerPaymentId: null,
        },
        data: {
          zohoCustomerPaymentId: remotePaymentId,
          zohoSyncRemotePaymentId: remotePaymentId,
          zohoSyncedAt: new Date(),
          zohoSyncStatus: ZohoSyncStatus.SYNCED,
          zohoSyncError: null,
        },
      });

      if (saved.count !== 1) {
        throw new ConflictException(
          'No se pudo guardar la confirmación de Zoho en el estado esperado.',
        );
      }

      return {
        dryRun: false,
        sentToZoho: true,
        localPaymentId: paymentId,
        zohoCustomerPaymentId: remotePaymentId,
        payload,
        zohoResponse,
      };
    } catch {
      // Un error HTTP, timeout o fallo al guardar NO prueba ausencia en Zoho.
      // Incluso si este update falla, SENDING conserva la prohibición de reenvío.
      const message = remotePaymentId
        ? 'Se recibió un ID de Zoho, pero no se pudo completar su registro local. Revisar antes de cualquier reenvío.'
        : 'No se conoce con certeza el resultado del envío. Revisar Zoho antes de cualquier reenvío.';
      try {
        await this.prisma.payment.updateMany({
          where: {
            id: paymentId,
            zohoSyncStatus: ZohoSyncStatus.SENDING,
            zohoSyncAttemptId: attemptId,
            zohoCustomerPaymentId: null,
          },
          data: {
            zohoSyncStatus: ZohoSyncStatus.REVIEW_REQUIRED,
            zohoSyncRemotePaymentId: remotePaymentId,
            zohoSyncError: message,
          },
        });
      } catch {
        throw new ServiceUnavailableException({
          message:
            'Resultado de envío incierto y no se pudo guardar el diagnóstico local. No reintentar el POST.',
          localPaymentId: paymentId,
          attemptId,
          remotePaymentId,
          reviewRequired: true,
        });
      }

      throw new ServiceUnavailableException({
        message,
        localPaymentId: paymentId,
        attemptId,
        remotePaymentId,
        reviewRequired: true,
      });
    }
  }

  private async prepareCustomerPayment(paymentId: string) {
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

    if (
      payment.zohoCustomerPaymentId ||
      payment.zohoSyncAttemptId ||
      payment.zohoSyncRemotePaymentId ||
      ![ZohoSyncStatus.NOT_SYNCED, ZohoSyncStatus.DRY_RUN_READY].some(
        (status) => status === payment.zohoSyncStatus,
      )
    ) {
      throw new ConflictException(
        'El pago ya fue enviado, está en proceso o requiere revisión. No se permite reenviarlo ni reiniciar su estado mediante un ensayo.',
      );
    }

    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException(
        'Solo se puede registrar en Zoho un pago confirmado.',
      );
    }

    if (!payment.customer.zohoCustomerId?.trim()) {
      throw new BadRequestException(
        'El cliente asociado no tiene zohoCustomerId.',
      );
    }

    if (payment.zohoCustomerPaymentId) {
      throw new BadRequestException(
        'Este pago ya tiene un zohoCustomerPaymentId asociado.',
      );
    }

    if (payment.currency !== 'CLP') {
      throw new BadRequestException(
        'Este flujo solo admite pagos en CLP; no realiza conversiones de moneda.',
      );
    }

    if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
      throw new BadRequestException(
        'El monto del pago debe ser un entero positivo en CLP.',
      );
    }

    if (!payment.paidAt || Number.isNaN(payment.paidAt.getTime())) {
      throw new BadRequestException(
        'El pago confirmado debe tener una fecha paidAt válida.',
      );
    }

    if (payment.documents.length === 0) {
      throw new BadRequestException('El pago no tiene documentos asociados.');
    }

    const seenInvoiceIds = new Set<string>();
    const invoices = payment.documents.map((paymentDocument) => {
      const document = paymentDocument.document;
      const invoiceId = document.zohoDocumentId?.trim();

      if (!invoiceId) {
        throw new BadRequestException(
          `El documento ${document.documentNumber} no tiene zohoDocumentId. No se generará un pago parcial.`,
        );
      }
      if (seenInvoiceIds.has(invoiceId)) {
        throw new BadRequestException(
          'El pago contiene una factura de Zoho repetida.',
        );
      }
      seenInvoiceIds.add(invoiceId);

      if (document.customerId !== payment.customerId) {
        throw new BadRequestException('Un documento pertenece a otro cliente.');
      }
      if (document.documentType !== DocumentType.INVOICE) {
        throw new BadRequestException(
          'Este flujo solo aplica pagos a facturas; otros tipos requieren un tratamiento separado.',
        );
      }
      if (document.currency !== payment.currency) {
        throw new BadRequestException(
          'La moneda de un documento no coincide con la del pago.',
        );
      }
      if (
        !Number.isSafeInteger(paymentDocument.amount) ||
        paymentDocument.amount <= 0
      ) {
        throw new BadRequestException(
          'Cada monto aplicado debe ser un entero positivo en CLP.',
        );
      }
      if (
        !Number.isSafeInteger(document.totalAmount) ||
        document.totalAmount <= 0 ||
        paymentDocument.amount > document.totalAmount
      ) {
        throw new BadRequestException(
          'El monto aplicado supera el total válido del documento.',
        );
      }

      // Se usa el monto asociado al pago. El saldo local puede haber quedado
      // en cero al confirmarlo y no sirve para reconstruir esta aplicación.
      return { invoice_id: invoiceId, amount_applied: paymentDocument.amount };
    });

    const amount = invoices.reduce(
      (sum, invoice) => sum + invoice.amount_applied,
      0,
    );
    if (!Number.isSafeInteger(amount) || amount !== payment.amount) {
      throw new BadRequestException(
        'La suma de los documentos no coincide exactamente con el monto confirmado del pago.',
      );
    }

    const payload: ZohoCreateCustomerPaymentPayload = {
      customer_id: payment.customer.zohoCustomerId,
      payment_mode:
        this.configService.get<string>('ZOHO_CUSTOMER_PAYMENT_MODE')?.trim() ||
        'banktransfer',
      amount,
      date: this.formatDate(payment.paidAt),
      reference_number: payment.khipuPaymentId ?? payment.id,
      description: `Pago registrado desde Portal Pago Express. Pago local: ${payment.id}`,
      invoices,
    };
    return { payment, payload };
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
