import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeRut } from '../../common/utils/rut.util';
import { ZohoAuthService } from './zoho-auth.service';
import type {
  ZohoContact,
  ZohoContactResponse,
} from './interfaces/zoho-contact.interface';
import type {
  ZohoInvoice,
  ZohoInvoicesResponse,
} from './interfaces/zoho-invoice.interface';

import type {
  MatchedZohoInvoice,
  ZohoDebtByRutResult,
} from './interfaces/zoho-debt-by-rut.interface';

type ZohoQueryParams = Record<string, string | number | boolean | undefined>;

interface ZohoRequestOptions {
  includeOrganizationId?: boolean;
}

@Injectable()
export class ZohoBooksService {
  constructor(
    private readonly configService: ConfigService,
    private readonly zohoAuthService: ZohoAuthService,
  ) {}

  async getFromBooks<TResponse>(
    path: string,
    queryParams: ZohoQueryParams = {},
    options: ZohoRequestOptions = { includeOrganizationId: true },
  ): Promise<TResponse> {
    const accessToken = await this.zohoAuthService.getAccessToken();

    const booksBaseUrl = this.getRequiredConfig('ZOHO_BOOKS_BASE_URL').replace(
      /\/$/,
      '',
    );

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${booksBaseUrl}${normalizedPath}`);

    if (options.includeOrganizationId !== false) {
      const organizationId = this.getRequiredConfig('ZOHO_ORGANIZATION_ID');
      url.searchParams.set('organization_id', organizationId);
    }

    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const data = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new ServiceUnavailableException({
        message: 'Zoho Books no respondió correctamente.',
        status: response.status,
        response: data,
      });
    }

    return data as TResponse;
  }

  async postToBooks<TResponse>(
    path: string,
    body: unknown,
    queryParams: ZohoQueryParams = {},
  ): Promise<TResponse> {
    const accessToken = await this.zohoAuthService.getAccessToken();

    const booksBaseUrl = this.getRequiredConfig('ZOHO_BOOKS_BASE_URL').replace(
      /\/$/,
      '',
    );

    const organizationId = this.getRequiredConfig('ZOHO_ORGANIZATION_ID');

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${booksBaseUrl}${normalizedPath}`);

    url.searchParams.set('organization_id', organizationId);

    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new ServiceUnavailableException({
        message: 'Zoho Books no respondió correctamente al crear el recurso.',
        status: response.status,
        response: data,
      });
    }

    return data as TResponse;
  }

  async listOrganizations() {
    return this.getFromBooks(
      '/organizations',
      {},
      { includeOrganizationId: false },
    );
  }

  async getConfiguredOrganization() {
    const organizationId = this.getRequiredConfig('ZOHO_ORGANIZATION_ID');

    return this.getFromBooks(
      `/organizations/${organizationId}`,
      {},
      { includeOrganizationId: false },
    );
  }

  async listUnpaidInvoicesTest() {
    return this.getFromBooks('/invoices', {
      status: 'unpaid',
      sort_column: 'customer_name',
      page: 1,
      per_page: 10,
    });
  }

  async listUnpaidInvoices(
    params: {
      startDate?: string;
      perPage?: number;
      maxPages?: number;
    } = {},
  ): Promise<ZohoInvoice[]> {
    const allInvoices: ZohoInvoice[] = [];
    const perPage = params.perPage ?? 200;
    const maxPages = params.maxPages ?? 20;

    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const response = await this.getFromBooks<ZohoInvoicesResponse>(
        '/invoices',
        {
          status: 'unpaid',
          sort_column: 'customer_name',
          page,
          per_page: perPage,
          date_after: params.startDate,
        },
      );

      allInvoices.push(...(response.invoices ?? []));

      hasMore =
        response.page_context?.has_more_page ??
        response.invoices?.length === perPage;

      page += 1;
    }

    return allInvoices;
  }

  async listUnpaidInvoicesForDebug(
    params: {
      startDate?: string;
      perPage?: number;
    } = {},
  ) {
    const invoices = await this.listUnpaidInvoices({
      startDate: params.startDate,
      perPage: params.perPage ?? 10,
      maxPages: 1,
    });

    return {
      count: invoices.length,
      invoices: invoices.map((invoice) => ({
        invoiceId: invoice.invoice_id ?? null,
        invoiceNumber: invoice.invoice_number ?? null,
        customerId: invoice.customer_id ?? null,
        customerName: invoice.customer_name ?? null,
        status: invoice.status ?? null,
        date: invoice.date ?? null,
        dueDate: invoice.due_date ?? null,
        total: invoice.total ?? null,
        balance: invoice.balance ?? null,
        currency: invoice.currency_code ?? null,
        availableKeys: Object.keys(invoice),
      })),
    };
  }

  async getContactById(contactId: string): Promise<ZohoContact | null> {
    const response = await this.getFromBooks<ZohoContactResponse>(
      `/contacts/${contactId}`,
    );

    return response.contact ?? null;
  }

  async findUnpaidInvoiceDebtByRut(
    normalizedRut: string,
  ): Promise<ZohoDebtByRutResult> {
    const invoices = await this.listUnpaidInvoices({
      perPage: 200,
      maxPages: 20,
    });

    const contactCache = new Map<string, ZohoContact | null>();
    const matchedInvoices: MatchedZohoInvoice[] = [];

    for (const invoice of invoices) {
      if (!invoice.customer_id) {
        continue;
      }

      let contact = contactCache.get(invoice.customer_id);

      if (!contactCache.has(invoice.customer_id)) {
        contact = await this.getContactById(invoice.customer_id);
        contactCache.set(invoice.customer_id, contact);
      }

      const contactNumber =
        typeof contact?.contact_number === 'string'
          ? normalizeRut(contact.contact_number)
          : null;

      if (contactNumber !== normalizedRut) {
        continue;
      }

      matchedInvoices.push({
        invoiceId: invoice.invoice_id ?? null,
        invoiceNumber: invoice.invoice_number ?? null,
        customerId: invoice.customer_id ?? null,
        customerName: invoice.customer_name ?? null,
        contactNumber: contact?.contact_number ?? null,
        status: invoice.status ?? null,
        date: invoice.date ?? null,
        dueDate: invoice.due_date ?? null,
        total: Number(invoice.total ?? 0),
        balance: Number(invoice.balance ?? 0),
        currency: invoice.currency_code ?? 'CLP',
      });
    }

    const totalDebt = matchedInvoices.reduce(
      (sum, invoice) => sum + invoice.balance,
      0,
    );

    return {
      normalizedRut,
      totalDebt,
      currency: matchedInvoices[0]?.currency ?? 'CLP',
      canPay: totalDebt > 0,
      invoiceCount: matchedInvoices.length,
      matchedInvoices,
      scannedInvoices: invoices.length,
      scannedContacts: contactCache.size,
    };
  }

  async findContactByRut(normalizedRut: string): Promise<ZohoContact | null> {
    const response = await this.getFromBooks<{
      code?: number;
      message?: string;
      contacts?: ZohoContact[];
    }>('/contacts', {
      search_text: normalizedRut,
      page: 1,
      per_page: 10,
    });

    const contacts = response.contacts ?? [];

    return (
      contacts.find((contact) => {
        if (typeof contact.contact_number !== 'string') {
          return false;
        }

        return normalizeRut(contact.contact_number) === normalizedRut;
      }) ?? null
    );
  }

  async findDebtByRutUsingContactFirst(normalizedRut: string) {
    const contact = await this.findContactByRut(normalizedRut);

    if (!contact?.contact_id) {
      return {
        normalizedRut,
        contactFound: false,
        totalDebt: 0,
        currency: 'CLP',
        canPay: false,
        invoiceCount: 0,
        invoices: [],
      };
    }

    const response = await this.getFromBooks<ZohoInvoicesResponse>(
      '/invoices',
      {
        customer_id: contact.contact_id,
        status: 'unpaid',
        page: 1,
        per_page: 200,
      },
    );

    const invoices = response.invoices ?? [];

    const mappedInvoices = invoices.map((invoice) => ({
      invoiceId: invoice.invoice_id ?? null,
      invoiceNumber: invoice.invoice_number ?? null,
      customerId: invoice.customer_id ?? null,
      customerName: invoice.customer_name ?? null,
      status: invoice.status ?? null,
      date: invoice.date ?? null,
      dueDate: invoice.due_date ?? null,
      total: Number(invoice.total ?? 0),
      balance: Number(invoice.balance ?? 0),
      currency: invoice.currency_code ?? 'CLP',
    }));

    const totalDebt = mappedInvoices.reduce(
      (sum, invoice) => sum + invoice.balance,
      0,
    );

    return {
      normalizedRut,
      contactFound: true,
      contact: {
        contactId: contact.contact_id,
        contactName: contact.contact_name ?? null,
        companyName: contact.company_name ?? null,
        contactNumber: contact.contact_number ?? null,
      },
      totalDebt,
      currency: mappedInvoices[0]?.currency ?? 'CLP',
      canPay: totalDebt > 0,
      invoiceCount: mappedInvoices.length,
      invoices: mappedInvoices,
    };
  }

  getConfigurationStatus() {
    return {
      clientIdConfigured: this.hasConfig('ZOHO_CLIENT_ID'),
      clientSecretConfigured: this.hasConfig('ZOHO_CLIENT_SECRET'),
      refreshTokenConfigured: this.hasConfig('ZOHO_REFRESH_TOKEN'),
      organizationIdConfigured: this.hasConfig('ZOHO_ORGANIZATION_ID'),
      accountsBaseUrlConfigured: this.hasConfig('ZOHO_ACCOUNTS_BASE_URL'),
      booksBaseUrlConfigured: this.hasConfig('ZOHO_BOOKS_BASE_URL'),
    };
  }

  private hasConfig(key: string): boolean {
    return Boolean(this.configService.get<string>(key)?.trim());
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new ServiceUnavailableException(
        `Falta configurar la variable de entorno ${key}.`,
      );
    }

    return value;
  }
}
