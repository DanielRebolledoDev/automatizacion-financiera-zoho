import { Injectable } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CustomerDataProvider,
  CustomerReference,
  PaymentExpressDebtSummary,
} from '../interfaces/customer-data-provider.interface';

@Injectable()
export class LocalCustomerDataProvider implements CustomerDataProvider {
  constructor(private readonly prisma: PrismaService) {}

  async getPaymentExpressSummaryByRut(
    normalizedRut: string,
  ): Promise<PaymentExpressDebtSummary | null> {
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
            currency: true,
          },
        },
      },
    });

    if (!customer) {
      return null;
    }

    const totalDebt = customer.documents.reduce(
      (sum, document) => sum + document.outstandingAmount,
      0,
    );

    return {
      customerId: customer.id,
      totalDebt,
      currency: customer.documents[0]?.currency ?? 'CLP',
      canPay: totalDebt > 0,
    };
  }

  async getCustomerReferenceByRut(
    normalizedRut: string,
  ): Promise<CustomerReference | null> {
    const customer = await this.prisma.customer.findUnique({
      where: {
        rutNormalized: normalizedRut,
      },
      select: {
        id: true,
      },
    });

    if (!customer) {
      return null;
    }

    return {
      customerId: customer.id,
    };
  }
}
