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

interface ZohoContactsResponse {
  code?: number;
  message?: string;
  contacts?: ZohoContact[];
  page_context?: {
    page?: number;
    per_page?: number;
    has_more_page?: boolean;
  };
}

export interface ZohoMappedInvoice {
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  status: string | null;
  date: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  currency: string;
}

interface ZohoContactDebtCandidate {
  contact: ZohoContact;
  totalDebt: number;
  currency: string;
  canPay: boolean;
  invoiceCount: number;
  invoices: ZohoMappedInvoice[];
}

export interface ZohoDebtByRutContactFirstResult {
  normalizedRut: string;
  contactFound: boolean;
  contact?: {
    contactId: string | undefined;
    contactName: string | null;
    companyName: string | null;
    contactNumber: string | null;
    contactType: string | null;
  };
  totalDebt: number;
  currency: string;
  canPay: boolean;
  invoiceCount: number;
  invoices: ZohoMappedInvoice[];
  matchedContactsCount?: number;
  selectedContactId?: string | null;
  candidateContacts?: Array<{
    contactId: string | null;
    contactName: string | null;
    companyName: string | null;
    contactNumber: string | null;
    contactType: string | null;
    totalDebt: number;
    invoiceCount: number;
  }>;
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

  async findContactsByRut(normalizedRut: string): Promise<ZohoContact[]> {
    const allContacts: ZohoContact[] = [];
    const perPage = 200;
    const maxPages = 5;

    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const response = await this.getFromBooks<ZohoContactsResponse>(
        '/contacts',
        {
          search_text: normalizedRut,
          contact_type: 'customer',
          page,
          per_page: perPage,
        },
      );

      const contacts = response.contacts ?? [];

      allContacts.push(...contacts);

      hasMore =
        response.page_context?.has_more_page ?? contacts.length === perPage;

      page += 1;
    }

    return allContacts.filter((contact) => {
      if (typeof contact.contact_number !== 'string') {
        return false;
      }

      return normalizeRut(contact.contact_number) === normalizedRut;
    });
  }

  async findContactByRut(normalizedRut: string): Promise<ZohoContact | null> {
    const contacts = await this.findContactsByRut(normalizedRut);

    return contacts[0] ?? null;
  }

  async listUnpaidInvoicesByContactId(
    contactId: string,
    maxPages = 5,
  ): Promise<ZohoInvoice[]> {
    const allInvoices: ZohoInvoice[] = [];
    const perPage = 200;

    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const response = await this.getFromBooks<ZohoInvoicesResponse>(
        '/invoices',
        {
          customer_id: contactId,
          status: 'unpaid',
          sort_column: 'due_date',
          page,
          per_page: perPage,
        },
      );

      const invoices = response.invoices ?? [];

      allInvoices.push(...invoices);

      hasMore =
        response.page_context?.has_more_page ?? invoices.length === perPage;

      page += 1;
    }

    return allInvoices;
  }

  async listInvoicesByContactIdForDebug(
    contactId: string,
  ): Promise<ZohoInvoice[]> {
    const allInvoices: ZohoInvoice[] = [];
    const perPage = 200;

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getFromBooks<ZohoInvoicesResponse>(
        '/invoices',
        {
          customer_id: contactId,
          sort_column: 'due_date',
          page,
          per_page: perPage,
        },
      );

      const invoices = response.invoices ?? [];

      allInvoices.push(...invoices);

      hasMore =
        response.page_context?.has_more_page ?? invoices.length === perPage;

      page += 1;
    }

    return allInvoices;
  }

  async listInvoicesByRutForDebug(normalizedRut: string) {
    const contact = await this.findContactByRut(normalizedRut);

    if (!contact?.contact_id) {
      return {
        normalizedRut,
        contactFound: false,
        contact: null,
        invoiceCount: 0,
        invoices: [],
      };
    }

    const invoices = await this.listInvoicesByContactIdForDebug(
      contact.contact_id,
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
      invoiceCount: invoices.length,
      invoices: invoices.map((invoice) => ({
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
        cfDteEmitido:
          typeof invoice.cf_dte_emitido === 'string'
            ? invoice.cf_dte_emitido
            : null,
        cfDteEstado:
          typeof invoice.cf_dte_estado === 'string'
            ? invoice.cf_dte_estado
            : null,
        cfDteFolio:
          typeof invoice.cf_dte_folio === 'string'
            ? invoice.cf_dte_folio
            : null,
        cfDteMontoTotal:
          typeof invoice.cf_dte_monto_total === 'string'
            ? invoice.cf_dte_monto_total
            : null,
        availableKeys: Object.keys(invoice),
      })),
    };
  }

  async findDebtByRutUsingContactFirst(
    normalizedRut: string,
  ): Promise<ZohoDebtByRutContactFirstResult> {
    const contacts = await this.findContactsByRut(normalizedRut);

    if (contacts.length === 0) {
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

    const sortedContacts = [...contacts].sort(
      (a, b) =>
        this.getContactReceivableAmount(b) - this.getContactReceivableAmount(a),
    );

    const evaluatedCandidates: ZohoContactDebtCandidate[] = [];

    for (const contact of sortedContacts) {
      if (!contact.contact_id) {
        continue;
      }

      const invoices = await this.listUnpaidInvoicesByContactId(
        contact.contact_id,
        3,
      );

      const mappedInvoices = invoices.map((invoice) =>
        this.mapZohoInvoice(invoice),
      );

      const totalDebt = this.calculateTotalDebt(mappedInvoices);

      const candidate: ZohoContactDebtCandidate = {
        contact,
        totalDebt,
        currency: mappedInvoices[0]?.currency ?? 'CLP',
        canPay: totalDebt > 0,
        invoiceCount: mappedInvoices.length,
        invoices: mappedInvoices,
      };

      evaluatedCandidates.push(candidate);

      if (candidate.totalDebt > 0) {
        return this.buildContactFirstDebtResult(
          normalizedRut,
          contacts.length,
          candidate,
          evaluatedCandidates,
        );
      }
    }

    const fallbackCandidate = evaluatedCandidates[0];

    if (!fallbackCandidate) {
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

    return this.buildContactFirstDebtResult(
      normalizedRut,
      contacts.length,
      fallbackCandidate,
      evaluatedCandidates,
    );
  }

  private mapZohoInvoice(invoice: ZohoInvoice): ZohoMappedInvoice {
    return {
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
    };
  }

  private calculateTotalDebt(invoices: ZohoMappedInvoice[]): number {
    return invoices.reduce((sum, invoice) => sum + invoice.balance, 0);
  }

  private getContactReceivableAmount(contact: ZohoContact): number {
    const value = contact['outstanding_receivable_amount'];
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  private buildContactFirstDebtResult(
    normalizedRut: string,
    matchedContactsCount: number,
    selectedCandidate: ZohoContactDebtCandidate,
    evaluatedCandidates: ZohoContactDebtCandidate[],
  ): ZohoDebtByRutContactFirstResult {
    const selectedContact = selectedCandidate.contact;

    return {
      normalizedRut,
      contactFound: true,
      contact: {
        contactId: selectedContact.contact_id,
        contactName: selectedContact.contact_name ?? null,
        companyName: selectedContact.company_name ?? null,
        contactNumber: selectedContact.contact_number ?? null,
        contactType:
          typeof selectedContact.contact_type === 'string'
            ? selectedContact.contact_type
            : null,
      },
      totalDebt: selectedCandidate.totalDebt,
      currency: selectedCandidate.currency,
      canPay: selectedCandidate.canPay,
      invoiceCount: selectedCandidate.invoiceCount,
      invoices: selectedCandidate.invoices,
      matchedContactsCount,
      selectedContactId: selectedContact.contact_id ?? null,
      candidateContacts: evaluatedCandidates.map((candidate) => ({
        contactId: candidate.contact.contact_id ?? null,
        contactName: candidate.contact.contact_name ?? null,
        companyName: candidate.contact.company_name ?? null,
        contactNumber: candidate.contact.contact_number ?? null,
        contactType:
          typeof candidate.contact.contact_type === 'string'
            ? candidate.contact.contact_type
            : null,
        totalDebt: candidate.totalDebt,
        invoiceCount: candidate.invoiceCount,
      })),
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
