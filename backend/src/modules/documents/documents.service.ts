import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findPendingByCustomerId(customerId: string) {
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
          orderBy: [
            {
              dueDate: 'asc',
            },
            {
              documentNumber: 'asc',
            },
          ],
          select: {
            id: true,
            zohoDocumentId: true,
            documentType: true,
            documentNumber: true,
            issueDate: true,
            dueDate: true,
            totalAmount: true,
            outstandingAmount: true,
            currency: true,
            status: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('No se encontró el cliente solicitado.');
    }

    return {
      message: 'Documentos pendientes obtenidos correctamente.',
      customer: {
        id: customer.id,
        rut: customer.rut,
        businessName: customer.businessName,
      },
      documents: customer.documents,
      totalDocuments: customer.documents.length,
    };
  }
}
