import {
  BadRequestException,
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
import { createHash } from 'crypto';
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

  async createPayment(createPaymentDto: CreatePaymentDto) {
    const customer = await this.prisma.customer.findUnique({
      where: {
        id: createPaymentDto.customerId,
      },
      select: {
        id: true,
        rut: true,
        businessName: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('No se encontró el cliente solicitado.');
    }

    const documents = await this.getDocumentsForPayment(createPaymentDto);

    if (documents.length === 0) {
      throw new BadRequestException(
        'No existen documentos pendientes para generar el pago.',
      );
    }

    const amount = documents.reduce(
      (sum, document) => sum + document.outstandingAmount,
      0,
    );

    if (amount <= 0) {
      throw new BadRequestException('El monto del pago debe ser mayor a cero.');
    }

    const documentIds = documents.map((document) => document.id);

    const existingPayment = await this.findActivePaymentForSameSelection({
      customerId: customer.id,
      mode: createPaymentDto.mode,
      amount,
      documentIds,
    });

    if (existingPayment) {
      const paymentToReturn =
        existingPayment.khipuPaymentId && existingPayment.khipuPaymentUrl
          ? existingPayment
          : await this.attachMockKhipuPayment({
              paymentId: existingPayment.id,
              customer,
              amount: existingPayment.amount,
              mode: existingPayment.mode,
            });

      return {
        message: 'Ya existe una intención de pago activa para esta selección.',
        reused: true,
        payment: this.mapPaymentResponse(paymentToReturn),
      };
    }

    const idempotencyKey = this.generateIdempotencyKey({
      customerId: customer.id,
      mode: createPaymentDto.mode,
      documentIds,
      amount,
    });

    const createdPayment = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          customerId: customer.id,
          mode: createPaymentDto.mode,
          amount,
          currency: 'CLP',
          status: PaymentStatus.CREATED,
          idempotencyKey,
        },
      });

      await tx.paymentDocument.createMany({
        data: documents.map((document) => ({
          paymentId: payment.id,
          documentId: document.id,
          amount: document.outstandingAmount,
        })),
      });

      return payment;
    });

    const paymentWithMockKhipu = await this.attachMockKhipuPayment({
      paymentId: createdPayment.id,
      customer,
      amount,
      mode: createPaymentDto.mode,
    });

    return {
      message: 'Intención de pago creada correctamente.',
      reused: false,
      payment: this.mapPaymentResponse(paymentWithMockKhipu),
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

    const updatedPayment = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: PaymentStatus.PAID,
          paidAt: now,
        },
      });

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
    const zohoSync = await this.tryAutoSyncPaidPaymentWithZoho(paymentId);
    return {
      message: 'Pago mock procesado correctamente.',
      alreadyProcessed: false,
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

    const updatedPayment = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: PaymentStatus.PAID,
          paidAt: now,
        },
      });

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

    const zohoSync = await this.tryAutoSyncPaidPaymentWithZoho(payment.id);

    return {
      message: 'Pago real de Khipu procesado correctamente.',
      alreadyProcessed: false,
      payment: this.mapPaymentResponse(updatedPayment),
      zohoSync,
    };
  }

  private async getDocumentsForPayment(createPaymentDto: CreatePaymentDto) {
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

      const documents = await this.prisma.customerDocument.findMany({
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
      return this.prisma.customerDocument.findMany({
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

    return this.prisma.customerDocument.findMany({
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

  private async attachMockKhipuPayment(params: {
    paymentId: string;
    customer: {
      id: string;
      rut: string;
      businessName: string;
    };
    amount: number;
    mode: PaymentMode;
  }) {
    const frontendUrl = this.getFrontendBaseUrl();
    const publicBackendUrl = this.getPublicBackendBaseUrl();

    const khipuPayment = await this.khipuService.createPayment({
      localPaymentId: params.paymentId,
      amount: params.amount,
      currency: 'CLP',
      subject: `Pago ${params.mode} - ${params.customer.businessName}`,
      body: `Pago generado desde Portal Pago Express. ID local: ${params.paymentId}`,
      returnUrl: `${frontendUrl}/pago-express/resultado/${params.paymentId}`,
      cancelUrl: `${frontendUrl}/pago-express`,
      notifyUrl: `${publicBackendUrl}/api/webhooks/khipu/real`,
    });

    const provider =
      this.configService.get<string>('KHIPU_PROVIDER')?.trim() ?? 'mock';

    return this.prisma.payment.update({
      where: {
        id: params.paymentId,
      },
      data: {
        status: PaymentStatus.PENDING,
        khipuPaymentId: khipuPayment.paymentId,
        khipuPaymentUrl: khipuPayment.paymentUrl,
        expiresAt: khipuPayment.expiresAt ?? null,
        attempts: {
          create: {
            customerId: params.customer.id,
            mode: params.mode,
            amount: params.amount,
            status: PaymentStatus.PENDING,
            requestPayload: {
              provider: provider === 'real' ? 'KHIPU_REAL' : 'MOCK_KHIPU',
              paymentId: params.paymentId,
              amount: params.amount,
              currency: 'CLP',
              subject: `Pago ${params.mode} - ${params.customer.businessName}`,
              customerRut: params.customer.rut,
              returnUrl: `${frontendUrl}/pago-express/resultado/${params.paymentId}`,
              cancelUrl: `${frontendUrl}/pago-express`,
              notifyUrl: `${publicBackendUrl}/api/webhooks/khipu/real`,
            },
            responsePayload: JSON.parse(
              JSON.stringify(khipuPayment),
            ) as Prisma.InputJsonValue,
          },
        },
      },
      include: {
        documents: {
          include: {
            document: true,
          },
        },
      },
    });
  }

  private async findActivePaymentForSameSelection(params: {
    customerId: string;
    mode: PaymentMode;
    amount: number;
    documentIds: string[];
  }) {
    const candidates = await this.prisma.payment.findMany({
      where: {
        customerId: params.customerId,
        mode: params.mode,
        amount: params.amount,
        status: {
          in: ACTIVE_PAYMENT_STATUSES,
        },
      },
      include: {
        documents: {
          include: {
            document: true,
          },
        },
      },
    });

    const requestedDocumentIds = [...params.documentIds].sort().join('|');

    return (
      candidates.find((payment) => {
        const paymentDocumentIds = payment.documents
          .map((paymentDocument) => paymentDocument.documentId)
          .sort()
          .join('|');

        return paymentDocumentIds === requestedDocumentIds;
      }) ?? null
    );
  }

  private generateIdempotencyKey(params: {
    customerId: string;
    mode: PaymentMode;
    documentIds: string[];
    amount: number;
  }) {
    const sortedDocumentIds = [...params.documentIds].sort();

    const rawKey = JSON.stringify({
      customerId: params.customerId,
      mode: params.mode,
      documentIds: sortedDocumentIds,
      amount: params.amount,
      createdAt: new Date().toISOString(),
    });

    return createHash('sha256').update(rawKey).digest('hex');
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
