import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseZohoListPage } from './utils/zoho-pagination.util';
import { normalizeRut } from '../../common/utils/rut.util';
import { ZohoAuthService } from './zoho-auth.service';
import type {
  ZohoContact,
  ZohoContactResponse,
} from './interfaces/zoho-contact.interface';
import type { ZohoInvoice } from './interfaces/zoho-invoice.interface';

import type {
  MatchedZohoInvoice,
  ZohoDebtByRutResult,
} from './interfaces/zoho-debt-by-rut.interface';

type ZohoQueryParams = Record<string, string | number | boolean | undefined>;

interface ZohoRequestOptions {
  includeOrganizationId?: boolean;
  expectedOrganizationId?: string;
  signal?: AbortSignal;
}

interface ZohoReadContext {
  organizationId: string;
  deadlineAtMs: number;
  signal: AbortSignal;
  remainingRequests: number;
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
    this.assertNoOrganizationOverride(queryParams);
    this.assertReadSignal(options.signal);
    const accessToken = await this.zohoAuthService.getAccessToken();
    // OAuth puede estar compartido con otra consulta. Si esta ya venció,
    // no iniciar una solicitud de negocio cuando termine el refresco.
    this.assertReadSignal(options.signal);

    const booksBaseUrl = this.getRequiredConfig('ZOHO_BOOKS_BASE_URL').replace(
      /\/$/,
      '',
    );

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${booksBaseUrl}${normalizedPath}`);

    if (
      options.includeOrganizationId === false &&
      options.expectedOrganizationId
    ) {
      throw new BadRequestException(
        'La consulta requiere incluir la organización esperada.',
      );
    }
    if (options.includeOrganizationId !== false) {
      const organizationId = this.checkedOrganizationId(
        options.expectedOrganizationId,
      );
      url.searchParams.set('organization_id', organizationId);
    }

    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    let response: Response;
    try {
      const requestTimeout = AbortSignal.timeout(15_000);
      response = await fetch(url, {
        method: 'GET',
        signal: options.signal
          ? AbortSignal.any([requestTimeout, options.signal])
          : requestTimeout,
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          Accept: 'application/json',
        },
      });
    } catch {
      this.assertReadSignal(options.signal);
      throw new ServiceUnavailableException({
        code: 'ZOHO_READ_FAILED',
        message:
          'No se pudo completar la lectura de Zoho dentro del tiempo permitido. Vuelve a consultar.',
      });
    }

    const data = (await response.json().catch(() => null)) as unknown;
    this.assertReadSignal(options.signal);

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
    expectedOrganizationId?: string,
  ): Promise<TResponse> {
    this.assertNoOrganizationOverride(queryParams);
    const accessToken = await this.zohoAuthService.getAccessToken();

    const booksBaseUrl = this.getRequiredConfig('ZOHO_BOOKS_BASE_URL').replace(
      /\/$/,
      '',
    );

    const organizationId = this.checkedOrganizationId(expectedOrganizationId);

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
      // Un timeout no prueba que Zoho no haya creado el recurso. No reintentar aquí.
      signal: AbortSignal.timeout(15_000),
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

  getOrganizationId(): string {
    return this.getRequiredConfig('ZOHO_ORGANIZATION_ID');
  }

  private checkedOrganizationId(expected?: string): string {
    const configured = this.getOrganizationId();
    if (expected !== undefined && expected !== configured) {
      throw new ConflictException(
        'La organización de Zoho cambió. No se realizará la solicitud.',
      );
    }
    return configured;
  }

  private assertNoOrganizationOverride(params: ZohoQueryParams): void {
    if (Object.prototype.hasOwnProperty.call(params, 'organization_id')) {
      throw new BadRequestException(
        'La organización no se puede sobrescribir mediante parámetros.',
      );
    }
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
    params: { startDate?: string; perPage?: number; maxPages?: number } = {},
  ): Promise<ZohoInvoice[]> {
    return this.collectZohoPages<ZohoInvoice>(
      '/invoices',
      'invoices',
      {
        status: 'unpaid',
        sort_column: 'customer_name',
        date_after: params.startDate,
      },
      params.perPage ?? 200,
      params.maxPages ?? 20,
    );
  }

  async listUnpaidInvoicesForDebug(
    params: {
      startDate?: string;
      perPage?: number;
    } = {},
  ) {
    const response = await this.getFromBooks<unknown>('/invoices', {
      status: 'unpaid',
      sort_column: 'customer_name',
      date_after: params.startDate,
      page: 1,
      per_page: params.perPage ?? 10,
    });
    const sample = parseZohoListPage(
      response,
      'invoices',
      1,
      new Set<string>(),
    );
    const invoices = sample.items as ZohoInvoice[];
    // Esta ruta es una muestra administrativa, nunca una deuda completa.
    return {
      count: invoices.length,
      isPartial: sample.hasMore,
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
    return this.withZohoReadContext((context) =>
      this.readContactsByRut(normalizedRut, context),
    );
  }

  private async readContactsByRut(
    rut: string,
    context: ZohoReadContext,
  ): Promise<ZohoContact[]> {
    const normalizedRut = normalizeRut(rut);
    // search_text busca nombre/notas; no garantiza buscar contact_number.
    // La identidad se resuelve con el catálogo completo, nunca con el primer match.
    const contacts = await this.collectZohoPages<ZohoContact>(
      '/contacts',
      'contacts',
      { contact_type: 'customer', sort_column: 'created_time' },
      200,
      this.readLimit('ZOHO_CONTACTS_MAX_PAGES', 50, 100),
      context,
    );
    return contacts.filter(
      (contact) =>
        (contact.contact_type === undefined ||
          contact.contact_type === 'customer') &&
        typeof contact.contact_number === 'string' &&
        normalizeRut(contact.contact_number) === normalizedRut,
    );
  }

  async findContactByRut(normalizedRut: string): Promise<ZohoContact | null> {
    const contacts = await this.findContactsByRut(normalizedRut);

    return contacts[0] ?? null;
  }

  async listUnpaidInvoicesByContactId(
    contactId: string,
    maxPages?: number,
  ): Promise<ZohoInvoice[]> {
    return this.withZohoReadContext((context) =>
      this.readUnpaidInvoicesByContactId(
        contactId,
        maxPages ?? this.readLimit('ZOHO_INVOICES_MAX_PAGES', 20, 100),
        context,
      ),
    );
  }

  private async readUnpaidInvoicesByContactId(
    contactId: string,
    maxPages: number,
    context: ZohoReadContext,
  ): Promise<ZohoInvoice[]> {
    const invoices = await this.collectZohoPages<ZohoInvoice>(
      '/invoices',
      'invoices',
      { customer_id: contactId, status: 'unpaid', sort_column: 'due_date' },
      200,
      maxPages,
      context,
    );
    if (invoices.some((invoice) => invoice.customer_id !== contactId)) {
      throw new ServiceUnavailableException(
        'Zoho devolvió facturas sin cliente coincidente. No se actualizará la deuda.',
      );
    }
    return invoices;
  }

  async listInvoicesByContactIdForDebug(
    contactId: string,
  ): Promise<ZohoInvoice[]> {
    return this.collectZohoPages<ZohoInvoice>(
      '/invoices',
      'invoices',
      { customer_id: contactId, sort_column: 'due_date' },
      200,
      20,
    );
  }

  private async collectZohoPages<T>(
    path: string,
    collection: 'invoices' | 'contacts',
    params: ZohoQueryParams,
    perPage: number,
    maxPages: number,
    context?: ZohoReadContext,
  ): Promise<T[]> {
    if (
      !Number.isInteger(perPage) ||
      perPage < 1 ||
      perPage > 200 ||
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 100
    ) {
      throw new BadRequestException('Límites de paginación inválidos.');
    }
    if (!context) {
      return this.withZohoReadContext((readContext) =>
        this.collectZohoPages<T>(
          path,
          collection,
          params,
          perPage,
          maxPages,
          readContext,
        ),
      );
    }
    const seenIds = new Set<string>();
    const records: Record<string, unknown>[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      this.assertReadContext(context);
      if (context.remainingRequests <= 0) {
        throw this.incompleteRead('REQUEST_LIMIT_REACHED', collection);
      }
      context.remainingRequests -= 1;
      const response = await this.getFromBooks<unknown>(
        path,
        { ...params, page, per_page: perPage },
        {
          expectedOrganizationId: context.organizationId,
          signal: context.signal,
        },
      );
      this.assertReadContext(context);
      const parsed = parseZohoListPage(response, collection, page, seenIds);
      records.push(...parsed.items);
      if (!parsed.hasMore) return records as T[];
    }
    // Nunca entregar un subconjunto como si fuera la deuda completa.
    throw this.incompleteRead('PAGE_LIMIT_REACHED', collection, maxPages);
  }

  private readLimit(key: string, fallback: number, maximum: number): number {
    const raw = this.configService.get<unknown>(key);
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d+$/.test(raw.trim())
          ? Number(raw.trim())
          : NaN;
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      throw new ServiceUnavailableException({
        code: 'ZOHO_READ_CONFIG_INVALID',
        setting: key,
        message: `La configuración ${key} debe ser un entero entre 1 y ${maximum}.`,
      });
    }
    return value;
  }

  private incompleteRead(
    reason:
      | 'PAGE_LIMIT_REACHED'
      | 'TIME_LIMIT_REACHED'
      | 'REQUEST_LIMIT_REACHED',
    collection?: 'contacts' | 'invoices',
    maxPages?: number,
  ): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'ZOHO_READ_INCOMPLETE',
      reason,
      collection,
      maxPages,
      message:
        'La consulta de deuda de Zoho quedó incompleta. No se actualizarán saldos ni se generará un pago con esta lectura.',
    });
  }

  private assertReadSignal(signal?: AbortSignal): void {
    if (signal?.aborted) throw this.incompleteRead('TIME_LIMIT_REACHED');
  }

  private assertReadContext(context: ZohoReadContext): void {
    this.assertReadSignal(context.signal);
    if (Date.now() >= context.deadlineAtMs) {
      throw this.incompleteRead('TIME_LIMIT_REACHED');
    }
    this.checkedOrganizationId(context.organizationId);
  }

  private async withZohoReadContext<T>(
    operation: (context: ZohoReadContext) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.readLimit(
      'ZOHO_DEBT_READ_TIMEOUT_MS',
      60_000,
      120_000,
    );
    const controller = new AbortController();
    const context: ZohoReadContext = {
      organizationId: this.getOrganizationId(),
      deadlineAtMs: Date.now() + timeoutMs,
      signal: controller.signal,
      remainingRequests: 100,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = this.incompleteRead('TIME_LIMIT_REACHED');
        controller.abort();
        reject(error);
      }, timeoutMs);
    });
    try {
      // La carrera también limita una espera de OAuth o una dependencia lenta.
      // Las comprobaciones entre páginas impiden que esa lectura siga después.
      const result = await Promise.race([operation(context), deadline]);
      this.assertReadContext(context);
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
    return this.withZohoReadContext((context) =>
      this.readDebtByRutUsingContactFirst(normalizeRut(normalizedRut), context),
    );
  }

  private async readDebtByRutUsingContactFirst(
    normalizedRut: string,
    context: ZohoReadContext,
  ): Promise<ZohoDebtByRutContactFirstResult> {
    const invoiceMaxPages = this.readLimit('ZOHO_INVOICES_MAX_PAGES', 20, 100);
    const contacts = await this.readContactsByRut(normalizedRut, context);

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
        this.getContactReceivableAmount(b) -
          this.getContactReceivableAmount(a) ||
        (a.contact_id ?? '').localeCompare(b.contact_id ?? ''),
    );

    const evaluatedCandidates: ZohoContactDebtCandidate[] = [];

    for (const contact of sortedContacts) {
      if (!contact.contact_id) {
        continue;
      }

      const invoices = await this.readUnpaidInvoicesByContactId(
        contact.contact_id,
        invoiceMaxPages,
        context,
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
    }

    // El modelo local guarda un solo zohoCustomerId. No elegir silenciosamente
    // una parte de la deuda si dos contactos del mismo RUT tienen saldo.
    const payableCandidates = evaluatedCandidates.filter(
      (candidate) => candidate.totalDebt > 0,
    );
    if (payableCandidates.length > 1) {
      throw new ConflictException({
        code: 'ZOHO_MULTIPLE_DEBT_CONTACTS',
        message:
          'Zoho tiene más de un contacto con deuda para este RUT. Revisa los contactos antes de generar un pago; no se actualizaron los saldos locales.',
      });
    }

    const fallbackCandidate = payableCandidates[0] ?? evaluatedCandidates[0];

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
