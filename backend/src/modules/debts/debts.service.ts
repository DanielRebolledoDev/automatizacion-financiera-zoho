import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DebtsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDebtSummaryByCustomerId(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: {
        id: customerId,
      },
      select: {
        id: true,
        rut: true,
        businessName: true,
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
            id: true,
            documentNumber: true,
            dueDate: true,
            outstandingAmount: true,
            status: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('No se encontró el cliente solicitado.');
    }

    const totalDebt = customer.documents.reduce(
      (sum, document) => sum + document.outstandingAmount,
      0,
    );

    const overdueDocuments = customer.documents.filter(
      (document) => document.status === DocumentStatus.OVERDUE,
    );

    const overdueDebt = overdueDocuments.reduce(
      (sum, document) => sum + document.outstandingAmount,
      0,
    );

    return {
      message: 'Resumen de deuda obtenido correctamente.',
      customer: {
        id: customer.id,
        rut: customer.rut,
        businessName: customer.businessName,
      },
      summary: {
        totalDebt,
        overdueDebt,
        pendingDocuments: customer.documents.length,
        overdueDocuments: overdueDocuments.length,
        currency: 'CLP',
      },
    };
  }
}
