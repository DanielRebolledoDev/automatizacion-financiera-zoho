import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentStatus,
  PaymentMode,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { KhipuService } from '../khipu/khipu.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

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

    const idempotencyKey = this.generateIdempotencyKey({
      customerId: customer.id,
      mode: createPaymentDto.mode,
      documentIds: documents.map((document) => document.id),
      amount,
    });

    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        idempotencyKey,
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
    const khipuPayment = await this.khipuService.createPayment({
      paymentId: params.paymentId,
      amount: params.amount,
      currency: 'CLP',
      subject: `Pago ${params.mode} - ${params.customer.businessName}`,
      customerRut: params.customer.rut,
    });

    return this.prisma.payment.update({
      where: {
        id: params.paymentId,
      },
      data: {
        status: PaymentStatus.PENDING,
        khipuPaymentId: khipuPayment.paymentId,
        khipuPaymentUrl: khipuPayment.paymentUrl,
        expiresAt: new Date(khipuPayment.expiresAt),
        attempts: {
          create: {
            customerId: params.customer.id,
            mode: params.mode,
            amount: params.amount,
            status: PaymentStatus.PENDING,
            requestPayload: {
              provider: 'MOCK_KHIPU',
              paymentId: params.paymentId,
              amount: params.amount,
              currency: 'CLP',
              subject: `Pago ${params.mode} - ${params.customer.businessName}`,
              customerRut: params.customer.rut,
            },
            responsePayload: khipuPayment as unknown as Prisma.InputJsonValue,
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
}
