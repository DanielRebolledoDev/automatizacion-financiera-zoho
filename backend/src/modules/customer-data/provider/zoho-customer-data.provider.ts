import { Injectable } from '@nestjs/common';
import { CustomerStatus, DocumentStatus, DocumentType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ZohoBooksService } from '../../zoho/zoho-books.service';
import type {
  CustomerDataProvider,
  CustomerReference,
  PaymentExpressDebtSummary,
} from '../interfaces/customer-data-provider.interface';

const PAYABLE_DOCUMENT_STATUSES: DocumentStatus[] = [
  DocumentStatus.PENDING,
  DocumentStatus.OVERDUE,
  DocumentStatus.PARTIALLY_PAID,
];

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
    /*
     * Zoho es la fuente de verdad.
     *
     * findDebtByRutUsingContactFirst devuelve las facturas que actualmente
     * están pendientes de pago en Zoho.
     */
    const zohoDebt =
      await this.zohoBooksService.findDebtByRutUsingContactFirst(normalizedRut);

    if (!zohoDebt.contactFound || !zohoDebt.contact?.contactId) {
      return null;
    }

    const businessName =
      zohoDebt.contact.companyName?.trim() ||
      zohoDebt.contact.contactName?.trim() ||
      'Cliente Zoho';

    /*
     * IDs y números que Zoho indica que actualmente siguen siendo pagables.
     */
    const currentZohoDocumentIds = new Set(
      zohoDebt.invoices
        .map((invoice) => invoice.invoiceId)
        .filter((invoiceId): invoiceId is string => Boolean(invoiceId)),
    );

    const currentDocumentNumbers = new Set(
      zohoDebt.invoices
        .map((invoice) => invoice.invoiceNumber)
        .filter((invoiceNumber): invoiceNumber is string =>
          Boolean(invoiceNumber),
        ),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: {
          rutNormalized: normalizedRut,
        },
        update: {
          rut: zohoDebt.contact?.contactNumber ?? normalizedRut,
          businessName,
          zohoCustomerId: zohoDebt.contact?.contactId,
          status: CustomerStatus.ACTIVE,
        },
        create: {
          rut: zohoDebt.contact?.contactNumber ?? normalizedRut,
          rutNormalized: normalizedRut,
          businessName,
          zohoCustomerId: zohoDebt.contact?.contactId,
          status: CustomerStatus.ACTIVE,
        },
      });

      /*
       * Primero sincronizamos todas las facturas que Zoho dice que
       * actualmente están pendientes.
       */
      for (const invoice of zohoDebt.invoices) {
        const documentNumber =
          invoice.invoiceNumber ?? invoice.invoiceId ?? `ZOHO-${Date.now()}`;

        await tx.customerDocument.upsert({
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

      /*
       * Ahora buscamos documentos que MariaDB todavía considera pagables.
       */
      const cachedPayableDocuments = await tx.customerDocument.findMany({
        where: {
          customerId: customer.id,
          status: {
            in: PAYABLE_DOCUMENT_STATUSES,
          },
          outstandingAmount: {
            gt: 0,
          },
        },
        select: {
          id: true,
          zohoDocumentId: true,
          documentNumber: true,
        },
      });

      /*
       * Si un documento local antes era pagable, pero ya NO aparece
       * entre las facturas impagas actuales de Zoho, deja de ser pagable
       * en nuestro caché local.
       */
      const staleDocumentIds = cachedPayableDocuments
        .filter((document) => {
          if (
            document.zohoDocumentId &&
            currentZohoDocumentIds.has(document.zohoDocumentId)
          ) {
            return false;
          }

          if (currentDocumentNumbers.has(document.documentNumber)) {
            return false;
          }

          return true;
        })
        .map((document) => document.id);

      if (staleDocumentIds.length > 0) {
        await tx.customerDocument.updateMany({
          where: {
            id: {
              in: staleDocumentIds,
            },
          },
          data: {
            outstandingAmount: 0,
            status: DocumentStatus.PAID,
          },
        });
      }

      return {
        customerId: customer.id,
        staleDocumentsClosed: staleDocumentIds.length,
      };
    });

    return {
      customerId: result.customerId,
      totalDebt: Math.round(zohoDebt.totalDebt),
      currency: zohoDebt.currency,
      staleDocumentsClosed: result.staleDocumentsClosed,
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
