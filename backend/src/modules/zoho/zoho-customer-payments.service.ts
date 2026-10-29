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
  EventSource,
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
import { validateInvoiceForPayment } from './utils/zoho-payment-preflight.util';
import {
  asObject,
  compareZohoPayment,
  validateStoredZohoPayload,
} from './utils/zoho-payment-reconciliation.util';

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

    const organizationId = this.zohoBooksService.getOrganizationId();
    await this.validateRemoteInvoices(payload, organizationId);

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
        zohoSyncOrganizationId: organizationId,
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
          {},
          organizationId,
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

  async reconcileCustomerPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment)
      throw new NotFoundException('No se encontró el pago solicitado.');

    const report = (
      outcome: string,
      message: string,
      details: Record<string, unknown> = {},
    ) => ({
      localPaymentId: paymentId,
      outcome,
      reconciled: false,
      remoteWriteAttempted: false,
      resendAllowed: false,
      message,
      ...details,
    });

    if (
      payment.zohoSyncStatus === ZohoSyncStatus.SYNCED &&
      payment.zohoCustomerPaymentId
    ) {
      return report(
        'ALREADY_SYNCED',
        'El pago ya tiene una confirmación local de Zoho.',
        {
          zohoCustomerPaymentId: payment.zohoCustomerPaymentId,
        },
      );
    }
    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException(
        'La conciliación requiere un pago local PAID.',
      );
    }
    if (payment.khipuPaymentId?.startsWith('mock_')) {
      return report(
        'MOCK_NOT_APPLICABLE',
        'El pago es Mock. No se consultó ni se escribió en Zoho.',
      );
    }
    if (payment.zohoSyncStatus === ZohoSyncStatus.SENDING) {
      return report(
        'SENDING_REQUIRES_INSPECTION',
        'La reserva sigue SENDING: puede haber una solicitud activa o interrumpida. No se cambia ni se libera automáticamente.',
      );
    }
    if (payment.zohoSyncStatus === ZohoSyncStatus.FAILED) {
      return report(
        'LEGACY_REQUIRES_INSPECTION',
        'Es un fallo anterior al registro persistente de intentos. Requiere revisión individual.',
      );
    }
    if (payment.zohoSyncStatus !== ZohoSyncStatus.REVIEW_REQUIRED) {
      return report(
        'NO_UNCERTAIN_ATTEMPT',
        'No hay un envío incierto registrado para conciliar.',
      );
    }
    if (
      payment.zohoCustomerPaymentId ||
      !payment.zohoSyncAttemptId ||
      !payment.khipuPaymentId
    ) {
      return report(
        'INCONSISTENT_LOCAL_STATE',
        'Falta evidencia del intento o el registro local es inconsistente.',
      );
    }

    const organizationId = payment.zohoSyncOrganizationId;
    if (!organizationId) {
      return report(
        'ORGANIZATION_NOT_RECORDED',
        'El intento no tiene organización registrada. Requiere revisión manual; no se infiere desde la configuración actual.',
      );
    }
    if (organizationId !== this.zohoBooksService.getOrganizationId()) {
      return report(
        'ORGANIZATION_MISMATCH',
        'La organización configurada no coincide con la del intento. No se consultó Zoho.',
      );
    }

    const stored = validateStoredZohoPayload(payment.zohoSyncPayload, {
      id: payment.id,
      amount: payment.amount,
      khipuPaymentId: payment.khipuPaymentId,
      currency: payment.currency,
    });
    if (!stored)
      return report(
        'INVALID_SNAPSHOT',
        'El contenido guardado del intento no permite una conciliación automática.',
      );

    const candidateIds = new Set<string>();
    let complete = false;
    // Búsqueda acotada. Un resultado incompleto nunca confirma ni permite reenviar.
    for (let page = 1; page <= 5; page += 1) {
      const response = asObject(
        await this.zohoBooksService.getFromBooks<unknown>(
          '/customerpayments',
          {
            customer_id: String(stored.customer_id),
            reference_number: String(stored.reference_number),
            page,
            per_page: 200,
          },
          { expectedOrganizationId: organizationId },
        ),
      );
      if (response?.code !== 0 || !Array.isArray(response.customerpayments)) {
        throw new ServiceUnavailableException(
          'Zoho respondió sin un listado válido de pagos. Se conserva el bloqueo.',
        );
      }
      for (const value of response.customerpayments) {
        const row = asObject(value);
        if (
          !row ||
          typeof row.payment_id !== 'string' ||
          !row.payment_id.trim() ||
          typeof row.customer_id !== 'string' ||
          typeof row.reference_number !== 'string'
        )
          return report(
            'INCOMPLETE_SEARCH',
            'El listado de Zoho no contiene suficientes datos para comprobar las coincidencias.',
          );
        if (
          row.customer_id === stored.customer_id &&
          row.reference_number === stored.reference_number
        ) {
          candidateIds.add(row.payment_id);
        }
      }
      if (candidateIds.size > 1) {
        return report(
          'MULTIPLE_MATCHES',
          'Hay varios pagos para el cliente y referencia. Revisión manual obligatoria.',
          {
            candidatePaymentIds: [...candidateIds],
          },
        );
      }
      const pagination = asObject(response.page_context);
      if (pagination?.has_more_page === false) {
        complete = true;
        break;
      }
      if (pagination?.has_more_page !== true) {
        return report(
          'INCOMPLETE_SEARCH',
          'Zoho no indicó si quedan páginas. No se confirma automáticamente.',
        );
      }
    }
    if (!complete)
      return report(
        'INCOMPLETE_SEARCH',
        'La búsqueda alcanzó su límite. Se conserva el bloqueo.',
      );
    if (candidateIds.size === 0) {
      return report(
        'NOT_FOUND',
        'No se encontró una coincidencia. Esto no demuestra que el envío nunca haya llegado; no se habilita el reenvío.',
      );
    }

    const remoteId = [...candidateIds][0];
    if (
      payment.zohoSyncRemotePaymentId &&
      payment.zohoSyncRemotePaymentId !== remoteId
    ) {
      return report(
        'REMOTE_ID_MISMATCH',
        'La coincidencia no corresponde al ID remoto guardado en el intento.',
      );
    }
    const detail = asObject(
      await this.zohoBooksService.getFromBooks<unknown>(
        `/customerpayments/${encodeURIComponent(remoteId)}`,
        {},
        { expectedOrganizationId: organizationId },
      ),
    );
    if (detail?.code !== 0) {
      throw new ServiceUnavailableException(
        'No se obtuvo un detalle válido de Zoho. Se conserva el bloqueo.',
      );
    }
    const differences = compareZohoPayment(stored, detail.payment, remoteId);
    if (differences.length > 0) {
      return report(
        'DATA_MISMATCH',
        'El pago remoto no coincide íntegramente con el intento guardado.',
        { differences },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PAID,
          updatedAt: payment.updatedAt,
          zohoSyncStatus: ZohoSyncStatus.REVIEW_REQUIRED,
          zohoSyncAttemptId: payment.zohoSyncAttemptId,
          zohoSyncOrganizationId: organizationId,
          zohoCustomerPaymentId: null,
        },
        data: {
          zohoCustomerPaymentId: remoteId,
          zohoSyncRemotePaymentId: remoteId,
          zohoSyncedAt: new Date(),
          zohoSyncStatus: ZohoSyncStatus.SYNCED,
          zohoSyncError: null,
        },
      });
      if (saved.count !== 1) {
        throw new ConflictException(
          'El estado local cambió durante la conciliación. Consulta el resultado antes de continuar.',
        );
      }
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          eventSource: EventSource.ZOHO,
          eventType: 'zoho.payment.reconciled',
          externalEventId: `zoho-reconciled-${payment.id}`,
          payload: {
            attemptId: payment.zohoSyncAttemptId,
            organizationId,
            zohoCustomerPaymentId: remoteId,
            matchedBy:
              'customer-reference-amount-currency-date-description-invoices',
          },
          processed: true,
          processedAt: new Date(),
        },
      });
    });

    return {
      localPaymentId: paymentId,
      outcome: 'RECONCILED',
      reconciled: true,
      zohoCustomerPaymentId: remoteId,
      remoteWriteAttempted: false,
      resendAllowed: false,
      message:
        'Se confirmó localmente el pago ya existente en Zoho. No se creó otro pago remoto.',
    };
  }

  private async validateRemoteInvoices(
    payload: ZohoCreateCustomerPaymentPayload,
    organizationId: string,
  ): Promise<void> {
    // Lecturas antes de reservar/enviar: un fallo aquí no crea un intento incierto.
    // No bloquean la factura remota frente a cambios posteriores de otros actores.
    for (const invoice of payload.invoices) {
      const response = await this.zohoBooksService.getFromBooks<unknown>(
        `/invoices/${encodeURIComponent(invoice.invoice_id)}`,
        {},
        { expectedOrganizationId: organizationId },
      );
      const differences = validateInvoiceForPayment(response, {
        invoiceId: invoice.invoice_id,
        customerId: payload.customer_id,
        amount: invoice.amount_applied,
      });
      if (differences.length > 0) {
        throw new ConflictException({
          message:
            'La factura de Zoho no permite aplicar el monto previsto. No se envió el pago.',
          invoiceId: invoice.invoice_id,
          differences,
        });
      }
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
