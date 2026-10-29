import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentStatus,
  EventSource,
  PaymentMode,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { KhipuService } from '../khipu/khipu.service';
import type { KhipuWebhookPayload } from '../khipu/interfaces/khipu-webhook.interface';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ZohoCustomerPaymentsService } from '../zoho/zoho-customer-payments.service';

const ACTIVE_PAYMENT_STATUSES = [
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
  PaymentStatus.IN_PROGRESS,
];

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly khipuService: KhipuService,
    private readonly configService: ConfigService,
    private readonly zohoCustomerPaymentsService: ZohoCustomerPaymentsService,
  ) {}

  async createPayment(
    createPaymentDto: CreatePaymentDto,
    options?: { expectedAmount?: number },
  ) {
    const provider =
      this.configService.get<string>('KHIPU_PROVIDER')?.trim() ?? 'mock';
    if (provider !== 'mock' && provider !== 'real') {
      throw new ServiceUnavailableException(
        'El proveedor de pago no es válido.',
      );
    }

    const reservation = await this.prisma.$transaction(
      async (tx) => {
        // Bloqueo persistente por cliente, compartido por todos los procesos.
        // Solo protege operaciones locales: nunca esperamos a Khipu aquí.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM customers
          WHERE id = ${createPaymentDto.customerId} FOR UPDATE
        `;
        if (locked.length !== 1) {
          throw new NotFoundException('No se encontró el cliente solicitado.');
        }
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: createPaymentDto.customerId },
          select: { id: true, rut: true, businessName: true },
        });
        const documents = await this.getDocumentsForPayment(
          createPaymentDto,
          tx,
        );
        if (documents.length === 0) {
          throw new BadRequestException(
            'No existen documentos pendientes para generar el pago.',
          );
        }
        if (
          documents.some(
            (document) =>
              document.currency !== 'CLP' ||
              !Number.isSafeInteger(document.outstandingAmount) ||
              document.outstandingAmount <= 0,
          )
        ) {
          throw new BadRequestException(
            'Los documentos deben tener saldos enteros positivos en CLP.',
          );
        }
        const amount = documents.reduce(
          (sum, document) => sum + document.outstandingAmount,
          0,
        );
        if (!Number.isSafeInteger(amount) || amount > 2147483647) {
          throw new BadRequestException('El monto supera el límite permitido.');
        }
        if (
          options?.expectedAmount !== undefined &&
          amount !== options.expectedAmount
        ) {
          throw new BadRequestException(
            'La deuda cambió durante la generación del pago. Vuelve a consultarla antes de pagar.',
          );
        }
        const existing = await this.findReservedPayment(tx, {
          customerId: customer.id,
          amount,
          documentIds: documents.map((document) => document.id),
          provider,
        });
        if (existing) {
          return { created: false as const, payment: existing };
        }

        const payment = await tx.payment.create({
          data: {
            customerId: customer.id,
            mode: createPaymentDto.mode,
            amount,
            currency: 'CLP',
            status: PaymentStatus.CREATED,
            idempotencyKey: `payment-${randomUUID()}`,
          },
        });
        await tx.paymentDocument.createMany({
          data: documents.map((document) => ({
            paymentId: payment.id,
            documentId: document.id,
            amount: document.outstandingAmount,
          })),
        });
        const attempt = await tx.paymentAttempt.create({
          data: {
            paymentId: payment.id,
            customerId: customer.id,
            mode: payment.mode,
            amount,
            status: PaymentStatus.CREATED,
            requestPayload: {
              action: 'create-payment',
              provider,
              localPaymentId: payment.id,
              amount,
              currency: 'CLP',
            },
          },
        });
        return {
          created: true as const,
          payment,
          customer,
          attemptId: attempt.id,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 10000,
      },
    );

    if (!reservation.created) {
      return {
        message: 'Ya existe una intención de pago activa para esta selección.',
        reused: true,
        payment: this.mapPaymentResponse(reservation.payment),
      };
    }

    // Solo la solicitud que creó y confirmó la reserva puede enviar el POST.
    // Una reserva sin URL jamás provoca un reenvío automático, ni tras reiniciar.
    const payment = await this.attachReservedKhipuPayment({
      paymentId: reservation.payment.id,
      customer: reservation.customer,
      amount: reservation.payment.amount,
      mode: reservation.payment.mode,
      attemptId: reservation.attemptId,
      provider,
    });
    return {
      message: 'Intención de pago creada correctamente.',
      reused: false,
      payment: this.mapPaymentResponse(payment),
    };
  }

  async findPaymentStatusById(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: {
        id: paymentId,
      },
      include: {
        customer: {
          select: {
            id: true,
            rut: true,
            businessName: true,
          },
        },
        documents: {
          include: {
            document: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        attempts: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 5,
          select: {
            id: true,
            mode: true,
            amount: true,
            status: true,
            errorMessage: true,
            createdAt: true,
          },
        },
        events: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 5,
          select: {
            id: true,
            eventSource: true,
            eventType: true,
            processed: true,
            processedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('No se encontró el pago solicitado.');
    }

    return {
      message: 'Estado de pago obtenido correctamente.',
      payment: {
        id: payment.id,
        mode: payment.mode,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        khipuPaymentId: payment.khipuPaymentId,
        khipuPaymentUrl: payment.khipuPaymentUrl,
        expiresAt: payment.expiresAt,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        customer: payment.customer,
        documents: payment.documents.map((paymentDocument) => ({
          id: paymentDocument.document.id,
          documentNumber: paymentDocument.document.documentNumber,
          documentType: paymentDocument.document.documentType,
          dueDate: paymentDocument.document.dueDate,
          totalAmount: paymentDocument.document.totalAmount,
          outstandingAmount: paymentDocument.document.outstandingAmount,
          paymentAmount: paymentDocument.amount,
          status: paymentDocument.document.status,
        })),
        attempts: payment.attempts,
        events: payment.events,
      },
    };
  }

  async markPaymentAsPaidFromMock(paymentId: string) {
    const provider =
      this.configService.get<string>('KHIPU_PROVIDER')?.trim() ?? 'mock';
    const environment = this.configService.get<string>('NODE_ENV')?.trim();

    if (provider !== 'mock' || environment === 'production') {
      throw new ForbiddenException(
        'La confirmación Mock solo está disponible en modo mock fuera de producción.',
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: {
        id: paymentId,
      },
      include: {
        customer: {
          select: {
            id: true,
            rut: true,
            businessName: true,
          },
        },
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

    if (!payment.khipuPaymentId?.startsWith('mock_')) {
      throw new ForbiddenException(
        'La confirmación Mock no puede aplicarse a un cobro real o sin proveedor.',
      );
    }

    if (payment.status === PaymentStatus.PAID) {
      return {
        message: 'El pago ya se encontraba marcado como pagado.',
        alreadyProcessed: true,
        payment: this.mapPaymentResponse(payment),
      };
    }

    if (
      payment.status === PaymentStatus.CANCELLED ||
      payment.status === PaymentStatus.FAILED ||
      payment.status === PaymentStatus.EXPIRED
    ) {
      throw new BadRequestException(
        'No se puede marcar como pagado un pago cancelado, fallido o expirado.',
      );
    }

    const now = new Date();
    const documentIds = payment.documents.map(
      (paymentDocument) => paymentDocument.documentId,
    );

    let alreadyProcessed = false;

    const updatedPayment = await this.prisma.$transaction(async (tx) => {
      const confirmation = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: {
            in: [
              PaymentStatus.CREATED,
              PaymentStatus.PENDING,
              PaymentStatus.IN_PROGRESS,
            ],
          },
        },
        data: {
          status: PaymentStatus.PAID,
          paidAt: now,
        },
      });

      if (confirmation.count === 0) {
        const currentPayment = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          include: {
            documents: {
              include: { document: true },
            },
          },
        });

        if (currentPayment.status === PaymentStatus.PAID) {
          alreadyProcessed = true;
          // Otra solicitud confirmó el pago: no repetimos sus efectos.
          return currentPayment;
        }

        throw new BadRequestException(
          'El pago cambió de estado y no puede confirmarse automáticamente. Consulta su estado actual.',
        );
      }

      await tx.customerDocument.updateMany({
        where: {
          id: {
            in: documentIds,
          },
        },
        data: {
          status: DocumentStatus.PAID,
          outstandingAmount: 0,
        },
      });

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          eventSource: EventSource.KHIPU,
          eventType: 'payment.paid.mock',
          externalEventId: `mock-paid-${payment.id}`,
          payload: {
            provider: 'MOCK_KHIPU',
            paymentId: payment.id,
            khipuPaymentId: payment.khipuPaymentId,
            status: PaymentStatus.PAID,
            receivedAt: now.toISOString(),
          },
          processed: true,
          processedAt: now,
        },
      });

      await tx.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          customerId: payment.customer.id,
          mode: payment.mode,
          amount: payment.amount,
          status: PaymentStatus.PAID,
          requestPayload: {
            provider: 'MOCK_KHIPU',
            action: 'mock-paid',
            paymentId: payment.id,
          },
          responsePayload: {
            status: PaymentStatus.PAID,
            processedAt: now.toISOString(),
          },
        },
      });

      return tx.payment.findUniqueOrThrow({
        where: {
          id: payment.id,
        },
        include: {
          documents: {
            include: {
              document: true,
            },
          },
        },
      });
    });
    const zohoSync = alreadyProcessed
      ? {
          attempted: false,
          sentToZoho: false,
          message:
            'Esta solicitud no repite la sincronización porque otra solicitud confirmó el pago.',
        }
      : await this.tryAutoSyncPaidPaymentWithZoho(payment.id);
    return {
      message: alreadyProcessed
        ? 'El pago ya se encontraba marcado como pagado.'
        : 'Pago mock procesado correctamente.',
      alreadyProcessed,
      payment: this.mapPaymentResponse(updatedPayment),
      zohoSync,
    };
  }

  async markPaymentAsPaidFromKhipuWebhook(params: {
    localPaymentId: string;
    khipuPaymentId: string;
    amount: number;
    currency: string;
    payload: KhipuWebhookPayload;
  }) {
    const payment = await this.prisma.payment.findUnique({
      where: {
        id: params.localPaymentId,
      },
      include: {
        customer: {
          select: {
            id: true,
            rut: true,
            businessName: true,
          },
        },
        documents: {
          include: {
            document: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        'No se encontró el pago informado por Khipu.',
      );
    }

    if (payment.khipuPaymentId !== params.khipuPaymentId) {
      throw new BadRequestException(
        'El payment_id informado por Khipu no coincide con el pago local.',
      );
    }

    if (payment.amount !== Math.round(params.amount)) {
      throw new BadRequestException(
        'El monto informado por Khipu no coincide con el pago local.',
      );
    }

    if (payment.currency !== params.currency) {
      throw new BadRequestException(
        'La moneda informada por Khipu no coincide con el pago local.',
      );
    }

    if (payment.status === PaymentStatus.PAID) {
      return {
        message: 'El pago ya se encontraba marcado como pagado.',
        alreadyProcessed: true,
        payment: this.mapPaymentResponse(payment),
      };
    }

    if (
      payment.status === PaymentStatus.CANCELLED ||
      payment.status === PaymentStatus.FAILED ||
      payment.status === PaymentStatus.EXPIRED
    ) {
      throw new BadRequestException(
        'No se puede marcar como pagado un pago cancelado, fallido o expirado.',
      );
    }

    const now = new Date();
    const documentIds = payment.documents.map(
      (paymentDocument) => paymentDocument.documentId,
    );

    const safePayload = JSON.parse(
      JSON.stringify(params.payload),
    ) as Prisma.InputJsonValue;

    let alreadyProcessed = false;

    const updatedPayment = await this.prisma.$transaction(async (tx) => {
      const confirmation = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: {
            in: [
              PaymentStatus.CREATED,
              PaymentStatus.PENDING,
              PaymentStatus.IN_PROGRESS,
            ],
          },
        },
        data: {
          status: PaymentStatus.PAID,
          paidAt: now,
        },
      });

      if (confirmation.count === 0) {
        const currentPayment = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          include: {
            documents: {
              include: { document: true },
            },
          },
        });

        if (currentPayment.status === PaymentStatus.PAID) {
          alreadyProcessed = true;
          // Otra solicitud confirmó el pago: no repetimos sus efectos.
          return currentPayment;
        }

        throw new BadRequestException(
          'El pago cambió de estado y no puede confirmarse automáticamente. Consulta su estado actual.',
        );
      }

      await tx.customerDocument.updateMany({
        where: {
          id: {
            in: documentIds,
          },
        },
        data: {
          status: DocumentStatus.PAID,
          outstandingAmount: 0,
        },
      });

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          eventSource: EventSource.KHIPU,
          eventType: 'payment.paid.real',
          externalEventId: `khipu-paid-${params.khipuPaymentId}`,
          payload: safePayload,
          processed: true,
          processedAt: now,
        },
      });

      await tx.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          customerId: payment.customer.id,
          mode: payment.mode,
          amount: payment.amount,
          status: PaymentStatus.PAID,
          requestPayload: {
            provider: 'KHIPU_REAL',
            action: 'webhook-paid',
            paymentId: payment.id,
            khipuPaymentId: params.khipuPaymentId,
          },
          responsePayload: safePayload,
        },
      });

      return tx.payment.findUniqueOrThrow({
        where: {
          id: payment.id,
        },
        include: {
          documents: {
            include: {
              document: true,
            },
          },
        },
      });
    });

    const zohoSync = alreadyProcessed
      ? {
          attempted: false,
          sentToZoho: false,
          message:
            'Esta solicitud no repite la sincronización porque otra solicitud confirmó el pago.',
        }
      : await this.tryAutoSyncPaidPaymentWithZoho(payment.id);

    return {
      message: alreadyProcessed
        ? 'El pago ya se encontraba marcado como pagado.'
        : 'Pago real de Khipu procesado correctamente.',
      alreadyProcessed,
      payment: this.mapPaymentResponse(updatedPayment),
      zohoSync,
    };
  }

  async refreshPaymentStatusFromKhipu(paymentId: string) {
    const readPayment = () =>
      this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          documents: {
            include: {
              document: true,
            },
          },
        },
      });

    const payment = await readPayment();

    if (!payment) {
      throw new NotFoundException('No se encontró el pago solicitado.');
    }

    const isActive = ACTIVE_PAYMENT_STATUSES.some(
      (status) => status === payment.status,
    );

    if (!isActive) {
      return {
        refreshed: false,
        message: 'El pago ya tiene un estado definitivo.',
        payment: this.mapPaymentResponse(payment),
      };
    }

    if (!payment.khipuPaymentId) {
      return {
        refreshed: false,
        message: 'El pago no tiene un identificador de Khipu.',
        payment: this.mapPaymentResponse(payment),
      };
    }

    const isMock = payment.khipuPaymentId.startsWith('mock_');

    let nextStatus: PaymentStatus;
    let expiresAt = payment.expiresAt;
    let khipuStatus: string;

    if (isMock) {
      // Los cobros Mock se consultan localmente, sin llamar a Khipu.
      const hasExpired =
        expiresAt !== null &&
        !Number.isNaN(expiresAt.getTime()) &&
        expiresAt.getTime() <= Date.now();

      nextStatus = hasExpired ? PaymentStatus.EXPIRED : payment.status;

      khipuStatus = 'mock';
    } else {
      const khipuResult = await this.khipuService.getPaymentById(
        payment.khipuPaymentId,
      );

      const khipuPayment = khipuResult.response;

      if (khipuPayment.payment_id !== payment.khipuPaymentId) {
        throw new BadRequestException(
          'El identificador informado por Khipu no coincide con el cobro local.',
        );
      }

      if (
        khipuPayment.transaction_id &&
        khipuPayment.transaction_id !== payment.id
      ) {
        throw new BadRequestException(
          'El pago consultado en Khipu no corresponde al pago local.',
        );
      }

      const khipuAmount = Math.round(Number(khipuPayment.amount));

      if (!Number.isFinite(khipuAmount) || khipuAmount !== payment.amount) {
        throw new BadRequestException(
          'El monto informado por Khipu no coincide con el pago local.',
        );
      }

      if (khipuPayment.currency !== payment.currency) {
        throw new BadRequestException(
          'La moneda informada por Khipu no coincide con el pago local.',
        );
      }

      if (khipuPayment.status === 'done') {
        const result = await this.markPaymentAsPaidFromKhipuWebhook({
          localPaymentId: payment.id,
          khipuPaymentId: payment.khipuPaymentId,
          amount: khipuAmount,
          currency: khipuPayment.currency,
          payload: khipuPayment,
        });

        return {
          refreshed: true,
          khipuStatus: 'done',
          ...result,
        };
      }

      if (
        khipuPayment.status !== 'pending' &&
        khipuPayment.status !== 'verifying'
      ) {
        throw new BadRequestException(
          'Khipu informó un estado de pago no reconocido.',
        );
      }

      khipuStatus = khipuPayment.status;

      if (khipuPayment.expires_date) {
        const parsedExpiresAt = new Date(khipuPayment.expires_date);

        if (!Number.isNaN(parsedExpiresAt.getTime())) {
          expiresAt = parsedExpiresAt;
        }
      }

      const hasExpired =
        expiresAt !== null &&
        !Number.isNaN(expiresAt.getTime()) &&
        expiresAt.getTime() <= Date.now();

      if (khipuPayment.status === 'verifying') {
        // Una transferencia en verificación no se expira por su fecha.
        nextStatus = PaymentStatus.IN_PROGRESS;
      } else if (payment.status === PaymentStatus.IN_PROGRESS) {
        // No retrocedemos por una respuesta pendiente potencialmente antigua.
        nextStatus = PaymentStatus.IN_PROGRESS;
      } else {
        nextStatus = hasExpired ? PaymentStatus.EXPIRED : PaymentStatus.PENDING;
      }
    }

    // Solo actualizamos si el registro sigue como estaba al leerlo.
    // Si un webhook u otra solicitud lo cambió, esta consulta no lo pisa.
    const updateResult = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: payment.status,
        updatedAt: payment.updatedAt,
      },
      data: {
        status: nextStatus,
        expiresAt,
      },
    });

    const currentPayment = await readPayment();

    if (!currentPayment) {
      throw new NotFoundException('No se encontró el pago solicitado.');
    }

    return {
      refreshed: updateResult.count > 0,
      khipuStatus,
      expired: currentPayment.status === PaymentStatus.EXPIRED,
      message:
        updateResult.count === 0
          ? 'El pago cambió durante la consulta; se devuelve su estado actual.'
          : 'Estado del pago consultado correctamente.',
      payment: this.mapPaymentResponse(currentPayment),
    };
  }

  async cancelKhipuPayment(paymentId: string) {
    const readPayment = () =>
      this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          documents: {
            include: {
              document: true,
            },
          },
        },
      });

    const payment = await readPayment();

    if (!payment) {
      throw new NotFoundException('No se encontró el pago solicitado.');
    }

    if (payment.status === PaymentStatus.CANCELLED) {
      return {
        cancelled: true,
        alreadyCancelled: true,
        message: 'El pago ya se encontraba cancelado.',
        payment: this.mapPaymentResponse(payment),
      };
    }

    if (
      payment.status === PaymentStatus.PAID ||
      payment.status === PaymentStatus.EXPIRED ||
      payment.status === PaymentStatus.FAILED
    ) {
      return {
        cancelled: false,
        alreadyCancelled: false,
        message: 'El pago ya tiene un estado definitivo.',
        payment: this.mapPaymentResponse(payment),
      };
    }

    if (!payment.khipuPaymentId) {
      throw new BadRequestException(
        'El pago no tiene un cobro de Khipu asociado.',
      );
    }

    const isMock = payment.khipuPaymentId.startsWith('mock_');

    if (!isMock) {
      const khipuResult = await this.khipuService.getPaymentById(
        payment.khipuPaymentId,
      );

      const khipuPayment = khipuResult.response;

      if (khipuPayment.payment_id !== payment.khipuPaymentId) {
        throw new BadRequestException(
          'El identificador informado por Khipu no coincide con el cobro local.',
        );
      }

      if (
        khipuPayment.transaction_id &&
        khipuPayment.transaction_id !== payment.id
      ) {
        throw new BadRequestException(
          'El pago consultado en Khipu no corresponde al pago local.',
        );
      }

      const khipuAmount = Math.round(Number(khipuPayment.amount));

      if (!Number.isFinite(khipuAmount) || khipuAmount !== payment.amount) {
        throw new BadRequestException(
          'El monto informado por Khipu no coincide con el pago local.',
        );
      }

      if (khipuPayment.currency !== payment.currency) {
        throw new BadRequestException(
          'La moneda informada por Khipu no coincide con el pago local.',
        );
      }

      if (khipuPayment.status === 'done') {
        const result = await this.markPaymentAsPaidFromKhipuWebhook({
          localPaymentId: payment.id,
          khipuPaymentId: payment.khipuPaymentId,
          amount: khipuAmount,
          currency: khipuPayment.currency,
          payload: khipuPayment,
        });

        return {
          ...result,
          cancelled: false,
          alreadyCancelled: false,
        };
      }

      if (khipuPayment.status === 'verifying') {
        // No sobrescribir estados definitivos que haya registrado
        // otra solicitud mientras consultábamos Khipu.
        await this.prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: {
              in: [PaymentStatus.CREATED, PaymentStatus.PENDING],
            },
          },
          data: {
            status: PaymentStatus.IN_PROGRESS,
          },
        });

        const currentPayment = await readPayment();

        if (!currentPayment) {
          throw new NotFoundException('No se encontró el pago solicitado.');
        }

        return {
          cancelled: currentPayment.status === PaymentStatus.CANCELLED,
          alreadyCancelled: currentPayment.status === PaymentStatus.CANCELLED,
          message:
            currentPayment.status === PaymentStatus.IN_PROGRESS
              ? 'Khipu está verificando el pago; no se solicitó su eliminación.'
              : 'El pago cambió durante la consulta; se devuelve su estado actual.',
          payment: this.mapPaymentResponse(currentPayment),
        };
      }

      if (khipuPayment.status !== 'pending') {
        throw new BadRequestException(
          'Khipu informó un estado de pago no reconocido.',
        );
      }
    }

    // Una respuesta pendiente no debe permitir cancelar un pago
    // que localmente ya estaba en verificación.
    if (payment.status === PaymentStatus.IN_PROGRESS) {
      const currentPayment = await readPayment();

      if (!currentPayment) {
        throw new NotFoundException('No se encontró el pago solicitado.');
      }

      return {
        cancelled: currentPayment.status === PaymentStatus.CANCELLED,
        alreadyCancelled: currentPayment.status === PaymentStatus.CANCELLED,
        message:
          'No se solicitó la cancelación porque el pago estaba en verificación.',
        payment: this.mapPaymentResponse(currentPayment),
      };
    }

    if (!isMock) {
      // Si Khipu rechaza la eliminación, se propaga el error:
      // no se registra una cancelación local exitosa.
      await this.khipuService.deletePayment(payment.khipuPaymentId);
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: {
            in: [PaymentStatus.CREATED, PaymentStatus.PENDING],
          },
        },
        data: {
          status: PaymentStatus.CANCELLED,
        },
      });

      // El evento y el cambio de estado se guardan juntos.
      // Una solicitud repetida no vuelve a crear el evento.
      if (updateResult.count > 0) {
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            eventSource: EventSource.KHIPU,
            eventType: 'payment.cancelled',
            externalEventId: `khipu-cancelled-${payment.khipuPaymentId}`,
            payload: {
              provider: isMock ? 'MOCK_KHIPU' : 'KHIPU_REAL',
              paymentId: payment.id,
              khipuPaymentId: payment.khipuPaymentId,
              cancelledAt: now.toISOString(),
            },
            processed: true,
            processedAt: now,
          },
        });
      }

      const currentPayment = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: {
          documents: {
            include: {
              document: true,
            },
          },
        },
      });

      return {
        changed: updateResult.count > 0,
        payment: currentPayment,
      };
    });

    const cancelled = result.payment.status === PaymentStatus.CANCELLED;

    return {
      cancelled,
      alreadyCancelled: cancelled && !result.changed,
      message: cancelled
        ? 'Cobro cancelado correctamente.'
        : 'El pago cambió durante la cancelación; se conserva su estado actual.',
      payment: this.mapPaymentResponse(result.payment),
    };
  }

  private async getDocumentsForPayment(
    createPaymentDto: CreatePaymentDto,
    tx: Prisma.TransactionClient,
  ) {
    const payableStatuses = [
      DocumentStatus.PENDING,
      DocumentStatus.OVERDUE,
      DocumentStatus.PARTIALLY_PAID,
    ];

    if (createPaymentDto.mode === PaymentMode.MANUAL_SELECTION) {
      if (
        !createPaymentDto.documentIds ||
        createPaymentDto.documentIds.length === 0
      ) {
        throw new BadRequestException(
          'Para pago por documentos seleccionados debe indicar documentIds.',
        );
      }

      const uniqueDocumentIds = [...new Set(createPaymentDto.documentIds)];

      const documents = await tx.customerDocument.findMany({
        where: {
          id: {
            in: uniqueDocumentIds,
          },
          customerId: createPaymentDto.customerId,
          status: {
            in: payableStatuses,
          },
          outstandingAmount: {
            gt: 0,
          },
        },
        orderBy: [
          {
            dueDate: 'asc',
          },
          {
            documentNumber: 'asc',
          },
        ],
      });

      if (documents.length !== uniqueDocumentIds.length) {
        throw new BadRequestException(
          'Uno o más documentos seleccionados no existen, no pertenecen al cliente o no están pendientes de pago.',
        );
      }

      return documents;
    }

    if (createPaymentDto.mode === PaymentMode.OVERDUE_DEBT) {
      return tx.customerDocument.findMany({
        where: {
          customerId: createPaymentDto.customerId,
          status: DocumentStatus.OVERDUE,
          outstandingAmount: {
            gt: 0,
          },
        },
        orderBy: [
          {
            dueDate: 'asc',
          },
          {
            documentNumber: 'asc',
          },
        ],
      });
    }

    return tx.customerDocument.findMany({
      where: {
        customerId: createPaymentDto.customerId,
        status: {
          in: payableStatuses,
        },
        outstandingAmount: {
          gt: 0,
        },
      },
      orderBy: [
        {
          dueDate: 'asc',
        },
        {
          documentNumber: 'asc',
        },
      ],
    });
  }

  private async attachReservedKhipuPayment(params: {
    paymentId: string;
    customer: { id: string; rut: string; businessName: string };
    amount: number;
    mode: PaymentMode;
    attemptId: string;
    provider: 'mock' | 'real';
  }) {
    let observedPaymentId: string | null = null;
    try {
      const frontendUrl = this.getFrontendBaseUrl();
      const publicBackendUrl = this.getPublicBackendBaseUrl();
      const currentProvider =
        this.configService.get<string>('KHIPU_PROVIDER')?.trim() ?? 'mock';
      if (currentProvider !== params.provider) {
        throw new ConflictException(
          'El proveedor cambió después de reservar el pago.',
        );
      }
      const khipuPayment = await this.khipuService.createPayment({
        localPaymentId: params.paymentId,
        amount: params.amount,
        currency: 'CLP',
        subject: `Pago ${params.mode} - ${params.customer.businessName}`,
        body: `Pago generado desde Portal Pago Express. ID local: ${params.paymentId}`,
        returnUrl: `${frontendUrl}/pago-express/resultado/${params.paymentId}`,
        cancelUrl: `${frontendUrl}/pago-express/resultado/${params.paymentId}?cancelled=1`,
        notifyUrl: `${publicBackendUrl}/api/webhooks/khipu/real`,
      });
      observedPaymentId = khipuPayment.paymentId;
      if (
        !khipuPayment.paymentId ||
        !khipuPayment.paymentUrl ||
        khipuPayment.paymentId.startsWith('mock_') !==
          (params.provider === 'mock')
      ) {
        throw new ServiceUnavailableException(
          'El proveedor devolvió un cobro inválido.',
        );
      }

      return await this.prisma.$transaction(async (tx) => {
        const attached = await tx.payment.updateMany({
          where: {
            id: params.paymentId,
            status: PaymentStatus.CREATED,
            khipuPaymentId: null,
            khipuPaymentUrl: null,
          },
          data: {
            status: PaymentStatus.PENDING,
            khipuPaymentId: khipuPayment.paymentId,
            khipuPaymentUrl: khipuPayment.paymentUrl,
            expiresAt: khipuPayment.expiresAt ?? null,
          },
        });
        if (attached.count !== 1) {
          throw new ConflictException(
            'El pago cambió mientras se creaba el cobro.',
          );
        }
        await tx.paymentAttempt.update({
          where: { id: params.attemptId },
          data: {
            status: PaymentStatus.PENDING,
            errorMessage: null,
            responsePayload: JSON.parse(
              JSON.stringify(khipuPayment),
            ) as Prisma.InputJsonValue,
          },
        });
        return tx.payment.findUniqueOrThrow({
          where: { id: params.paymentId },
          include: { documents: { include: { document: true } } },
        });
      });
    } catch {
      // No sabemos si Khipu recibió el POST. Conservamos CREATED y su reserva.
      // El diagnóstico es secundario: aunque falle, el bloqueo queda persistido.
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.paymentAttempt.update({
            where: { id: params.attemptId },
            data: {
              errorMessage:
                'Creación sin confirmar. Requiere revisión; no reenviar automáticamente.',
              responsePayload: { reviewRequired: true, observedPaymentId },
            },
          });
          await tx.paymentEvent.create({
            data: {
              paymentId: params.paymentId,
              eventSource: EventSource.SYSTEM,
              eventType: 'payment.creation.review_required',
              externalEventId: `creation-review-${params.paymentId}`,
              payload: { provider: params.provider, observedPaymentId },
              processed: false,
            },
          });
        });
      } catch {
        // No liberar la reserva si también falla la escritura del diagnóstico.
      }
      throw new ServiceUnavailableException({
        message:
          'No se pudo confirmar la creación del cobro. No se generará otro automáticamente. Contacta a soporte con el ID del pago.',
        paymentId: params.paymentId,
        code: 'PAYMENT_CREATION_REVIEW_REQUIRED',
      });
    }
  }

  private async findReservedPayment(
    tx: Prisma.TransactionClient,
    params: {
      customerId: string;
      amount: number;
      documentIds: string[];
      provider: 'mock' | 'real';
    },
  ) {
    const candidates = await tx.payment.findMany({
      where: {
        customerId: params.customerId,
        status: { in: [...ACTIVE_PAYMENT_STATUSES, PaymentStatus.PAID] },
        documents: { some: { documentId: { in: params.documentIds } } },
      },
      include: { documents: { include: { document: true } } },
    });
    const active: typeof candidates = [];
    for (const payment of candidates) {
      if (payment.status === PaymentStatus.PAID) {
        throw new ConflictException(
          'Una factura seleccionada ya tiene un pago confirmado en el portal. Debe revisarse su sincronización antes de volver a cobrarla.',
        );
      }
      if (
        payment.khipuPaymentId?.startsWith('mock_') &&
        payment.status !== PaymentStatus.IN_PROGRESS &&
        payment.expiresAt &&
        payment.expiresAt.getTime() <= Date.now()
      ) {
        const expired = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: payment.status,
            updatedAt: payment.updatedAt,
          },
          data: { status: PaymentStatus.EXPIRED },
        });
        if (expired.count !== 1) {
          throw new ConflictException(
            'El pago cambió; consulta su estado antes de continuar.',
          );
        }
        continue;
      }
      active.push(payment);
    }
    if (active.length === 0) return null;
    if (active.length !== 1) {
      throw new ConflictException(
        'Hay varios cobros activos para estas facturas. Requieren revisión.',
      );
    }
    const payment = active[0];
    if (!payment.khipuPaymentId || !payment.khipuPaymentUrl) {
      throw new ConflictException({
        message:
          'Ya existe un cobro en preparación o pendiente de revisión. Espera la respuesta de la primera solicitud; si el problema persiste, contacta a soporte.',
        paymentId: payment.id,
        code: 'PAYMENT_CREATION_RESERVED',
      });
    }
    if (
      payment.khipuPaymentId.startsWith('mock_') !==
      (params.provider === 'mock')
    ) {
      throw new ConflictException(
        'Existe un cobro de otro entorno para estas facturas. Revísalo antes de generar uno nuevo.',
      );
    }
    const requested = [...params.documentIds].sort().join('|');
    const reserved = payment.documents
      .map((item) => item.documentId)
      .sort()
      .join('|');
    if (requested !== reserved || payment.amount !== params.amount) {
      throw new ConflictException(
        'Estas facturas ya tienen un cobro activo con otra selección o monto. Revísalo antes de generar uno nuevo.',
      );
    }
    return payment;
  }

  private mapPaymentResponse(
    payment: Prisma.PaymentGetPayload<{
      include: {
        documents: {
          include: {
            document: true;
          };
        };
      };
    }>,
  ) {
    return {
      id: payment.id,
      mode: payment.mode,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      khipuPaymentId: payment.khipuPaymentId,
      khipuPaymentUrl: payment.khipuPaymentUrl,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      documents: payment.documents.map((paymentDocument) => ({
        id: paymentDocument.document.id,
        documentNumber: paymentDocument.document.documentNumber,
        documentType: paymentDocument.document.documentType,
        dueDate: paymentDocument.document.dueDate,
        totalAmount: paymentDocument.document.totalAmount,
        outstandingAmount: paymentDocument.document.outstandingAmount,
        paymentAmount: paymentDocument.amount,
        status: paymentDocument.document.status,
      })),
    };
  }
  private async tryAutoSyncPaidPaymentWithZoho(paymentId: string) {
    const autoSyncEnabled =
      this.configService.get<string>('ZOHO_AUTO_SYNC_PAYMENTS_ENABLED') ===
      'true';

    if (!autoSyncEnabled) {
      return {
        enabled: false,
        attempted: false,
        sentToZoho: false,
        message: 'Sincronización automática con Zoho desactivada.',
      };
    }

    try {
      const result =
        await this.zohoCustomerPaymentsService.syncCustomerPaymentToZoho(
          paymentId,
        );

      return {
        enabled: true,
        attempted: true,
        sentToZoho: result.sentToZoho,
        zohoCustomerPaymentId: result.zohoCustomerPaymentId,
        dryRun: result.dryRun,
      };
    } catch (error) {
      return {
        enabled: true,
        attempted: true,
        sentToZoho: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error desconocido al sincronizar pago con Zoho.',
      };
    }
  }

  private getFrontendBaseUrl(): string {
    const corsOrigins =
      this.configService.get<string>('CORS_ALLOWED_ORIGINS')?.trim() ?? '';

    const firstOrigin = corsOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)[0];

    return firstOrigin || 'http://localhost:5173';
  }

  private getPublicBackendBaseUrl(): string {
    const publicBackendUrl =
      this.configService.get<string>('PUBLIC_BACKEND_URL')?.trim() ?? '';

    return publicBackendUrl.replace(/\/$/, '') || 'http://localhost:3000';
  }
}
