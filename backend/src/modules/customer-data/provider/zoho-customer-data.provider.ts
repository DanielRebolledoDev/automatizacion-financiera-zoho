import { Injectable } from '@nestjs/common';
import { CustomerStatus, DocumentStatus, DocumentType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ZohoBooksService } from '../../zoho/zoho-books.service';
import type {
  CustomerDataProvider,
  CustomerReference,
  PaymentExpressDebtSummary,
} from '../interfaces/customer-data-provider.interface';

@Injectable()
export class ZohoCustomerDataProvider implements CustomerDataProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zohoBooksService: ZohoBooksService,
  ) {}

  async getPaymentExpressSummaryByRut(
    normalizedRut: string,
  ): Promise<PaymentExpressDebtSummary | null> {
    const syncedCustomer = await this.syncCustomerDebtFromZoho(normalizedRut);

    if (!syncedCustomer) {
      return null;
    }

    return {
      customerId: syncedCustomer.customerId,
      totalDebt: syncedCustomer.totalDebt,
      currency: syncedCustomer.currency,
      canPay: syncedCustomer.totalDebt > 0,
    };
  }

  async getCustomerReferenceByRut(
    normalizedRut: string,
  ): Promise<CustomerReference | null> {
    const syncedCustomer = await this.syncCustomerDebtFromZoho(normalizedRut);

    if (!syncedCustomer) {
      return null;
    }

    return {
      customerId: syncedCustomer.customerId,
    };
  }

  private async syncCustomerDebtFromZoho(normalizedRut: string) {
    const zohoDebt =
      await this.zohoBooksService.findDebtByRutUsingContactFirst(normalizedRut);

    if (!zohoDebt.contactFound || !zohoDebt.contact?.contactId) {
      return null;
    }

    const businessName =
      zohoDebt.contact.companyName?.trim() ||
      zohoDebt.contact.contactName?.trim() ||
      'Cliente Zoho';

    const customer = await this.prisma.customer.upsert({
      where: {
        rutNormalized: normalizedRut,
      },
      update: {
        rut: zohoDebt.contact.contactNumber ?? normalizedRut,
        businessName,
        zohoCustomerId: zohoDebt.contact.contactId,
        status: CustomerStatus.ACTIVE,
      },
      create: {
        rut: zohoDebt.contact.contactNumber ?? normalizedRut,
        rutNormalized: normalizedRut,
        businessName,
        zohoCustomerId: zohoDebt.contact.contactId,
        status: CustomerStatus.ACTIVE,
      },
    });

    for (const invoice of zohoDebt.invoices) {
      const documentNumber =
        invoice.invoiceNumber ?? invoice.invoiceId ?? `ZOHO-${Date.now()}`;

      await this.prisma.customerDocument.upsert({
        where: {
          customerId_documentNumber: {
            customerId: customer.id,
            documentNumber,
          },
        },
        update: {
          zohoDocumentId: invoice.invoiceId,
          documentType: DocumentType.INVOICE,
          issueDate: invoice.date ? new Date(invoice.date) : null,
          dueDate: invoice.dueDate ? new Date(invoice.dueDate) : new Date(),
          totalAmount: Math.round(invoice.total),
          outstandingAmount: Math.round(invoice.balance),
          currency: invoice.currency,
          status: this.mapZohoInvoiceStatus(invoice.status),
        },
        create: {
          customerId: customer.id,
          zohoDocumentId: invoice.invoiceId,
          documentType: DocumentType.INVOICE,
          documentNumber,
          issueDate: invoice.date ? new Date(invoice.date) : null,
          dueDate: invoice.dueDate ? new Date(invoice.dueDate) : new Date(),
          totalAmount: Math.round(invoice.total),
          outstandingAmount: Math.round(invoice.balance),
          currency: invoice.currency,
          status: this.mapZohoInvoiceStatus(invoice.status),
        },
      });
    }

    return {
      customerId: customer.id,
      totalDebt: zohoDebt.totalDebt,
      currency: zohoDebt.currency,
    };
  }

  private mapZohoInvoiceStatus(status: string | null): DocumentStatus {
    const normalizedStatus = status?.toLowerCase();

    if (normalizedStatus === 'overdue') {
      return DocumentStatus.OVERDUE;
    }

    if (
      normalizedStatus === 'partially_paid' ||
      normalizedStatus === 'partially paid'
    ) {
      return DocumentStatus.PARTIALLY_PAID;
    }

    if (normalizedStatus === 'paid') {
      return DocumentStatus.PAID;
    }

    if (normalizedStatus === 'void') {
      return DocumentStatus.VOID;
    }

    return DocumentStatus.PENDING;
  }
}
