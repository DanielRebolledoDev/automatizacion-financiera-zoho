'use strict';

// Solo lectura de Zoho. No inicializa Nest, Prisma ni una base de datos local.
// El archivo separado evita pasar JavaScript UTF-8 por stdin de PowerShell 5.1.
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = __dirname;
const backend = path.join(projectRoot, 'backend');
const output = path.join(projectRoot, 'diagnostico-paginacion-zoho.json');
const report = {
  diagnostic: 'zoho-pagination-37d-fix',
  completed: false,
  localDatabaseAccessed: false,
  businessWritesAttempted: false,
  pages: [],
};
const originalFetch = globalThis.fetch;
const maxApiReads = 100;
let apiReads = 0;
let stage = 'INITIALIZATION';

class DiagnosticFailure extends Error {
  constructor(reason) {
    super('El diagnostico no pudo continuar.');
    this.diagnosticReason = reason;
  }
}

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeErrorTag(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value)
    ? value
    : null;
}

function describeError(error) {
  let response = null;
  let status = null;
  try {
    response = asObject(error?.getResponse?.());
    status = safeNumber(error?.getStatus?.());
  } catch {
    // Nunca imprimir la excepcion ni el cuerpo recibido de Zoho.
  }
  const description = {
    backendHttpStatus: status,
    code: safeErrorTag(response?.code) ?? safeNumber(response?.code),
    reason: safeErrorTag(response?.reason) ?? 'CONSULTATION_FAILED',
  };
  if (error instanceof DiagnosticFailure) {
    description.code = 'DIAGNOSTIC_BLOCKED';
    description.reason = error.diagnosticReason;
  }
  if (Number.isInteger(response?.maxPages) && response.maxPages > 0) {
    description.maxPages = response.maxPages;
  }
  return description;
}

function configuredUrl(value, reason) {
  try {
    return new URL(value);
  } catch {
    throw new DiagnosticFailure(reason);
  }
}

async function main() {
  if (process.argv[2] && path.resolve(process.argv[2]) !== output) {
    throw new DiagnosticFailure('INVALID_OUTPUT_PATH');
  }
  if (!fs.existsSync(path.join(backend, 'package.json'))) {
    throw new DiagnosticFailure('BACKEND_NOT_FOUND');
  }
  const buildRoot = [
    path.join(backend, 'dist'),
    path.join(backend, 'dist/src'),
  ].find((candidate) =>
    fs.existsSync(path.join(candidate, 'modules/zoho/zoho-books.service.js')),
  );
  if (!buildRoot) throw new DiagnosticFailure('BUILD_REQUIRED');
  if (typeof originalFetch !== 'function') {
    throw new DiagnosticFailure('FETCH_UNAVAILABLE');
  }

  const booksUrl = configuredUrl(
    process.env.ZOHO_BOOKS_BASE_URL,
    'UNEXPECTED_ZOHO_ENDPOINT',
  );
  const authUrl = configuredUrl(
    process.env.ZOHO_ACCOUNTS_BASE_URL || 'https://accounts.zoho.com',
    'UNEXPECTED_ZOHO_ENDPOINT',
  );
  if (
    booksUrl.origin !== 'https://www.zohoapis.com' ||
    booksUrl.pathname.replace(/\/$/, '') !== '/books/v3' ||
    booksUrl.username ||
    booksUrl.password ||
    booksUrl.search ||
    booksUrl.hash ||
    authUrl.origin !== 'https://accounts.zoho.com' ||
    authUrl.pathname !== '/' ||
    authUrl.username ||
    authUrl.password ||
    authUrl.search ||
    authUrl.hash
  ) {
    throw new DiagnosticFailure('UNEXPECTED_ZOHO_ENDPOINT');
  }

  // Se instala antes de cargar los servicios; ninguna otra operacion de red
  // mediante fetch puede salir durante esta ejecucion.
  globalThis.fetch = async (input, options = {}) => {
    const requestInput =
      typeof Request === 'function' && input instanceof Request;
    const url = configuredUrl(
      requestInput ? input.url : String(input),
      'NETWORK_OPERATION_BLOCKED',
    );
    const method = String(
      options.method ?? (requestInput ? input.method : 'GET'),
    ).toUpperCase();
    const validHttpsUrl =
      url.protocol === 'https:' && !url.username && !url.password;
    const tokenRequest =
      validHttpsUrl &&
      method === 'POST' &&
      url.origin === authUrl.origin &&
      url.pathname === '/oauth/v2/token';
    const readRequest =
      validHttpsUrl &&
      method === 'GET' &&
      url.origin === booksUrl.origin &&
      ['/books/v3/contacts', '/books/v3/invoices'].includes(url.pathname);
    if (!tokenRequest && !readRequest) {
      throw new DiagnosticFailure('NETWORK_OPERATION_BLOCKED');
    }
    if (readRequest) {
      if (apiReads >= maxApiReads) {
        throw new DiagnosticFailure('DIAGNOSTIC_READ_LIMIT');
      }
      apiReads += 1;
    }
    // Conserva signal y las demas opciones del servicio. Un redirect falla
    // antes de seguirlo, incluso si cambiara de dominio o de ruta.
    return originalFetch(input, { ...options, redirect: 'error' });
  };

  const { ConfigService } = require(
    require.resolve('@nestjs/config', {
      paths: [backend],
    }),
  );
  const { ZohoAuthService } = require(
    path.join(buildRoot, 'modules/zoho/zoho-auth.service.js'),
  );
  const { ZohoBooksService } = require(
    path.join(buildRoot, 'modules/zoho/zoho-books.service.js'),
  );
  const { normalizeRut, isValidRut } = require(
    path.join(buildRoot, 'common/utils/rut.util.js'),
  );
  const rut = normalizeRut(process.env.ZOHO_DIAGNOSTIC_RUT || '');
  if (!isValidRut(rut)) throw new DiagnosticFailure('INVALID_RUT');

  const config = new ConfigService(process.env);
  const service = new ZohoBooksService(config, new ZohoAuthService(config));
  const read = service.getFromBooks.bind(service);
  service.getFromBooks = async (endpoint, query = {}, options) => {
    if (!['/contacts', '/invoices'].includes(endpoint)) {
      throw new DiagnosticFailure('NETWORK_OPERATION_BLOCKED');
    }
    if (report.pages.length >= maxApiReads) {
      throw new DiagnosticFailure('DIAGNOSTIC_READ_LIMIT');
    }
    stage = endpoint === '/contacts' ? 'CONTACTS' : 'INVOICES';
    const row = {
      collection: endpoint.slice(1),
      requestedPage: safeNumber(query.page),
      requestedPerPage: safeNumber(query.per_page),
      queryKeys: Object.keys(query).sort(),
      customerIdFilterPresent:
        typeof query.customer_id === 'string' && query.customer_id.length > 0,
      contactTypeCustomerFilterPresent: query.contact_type === 'customer',
      rutSearchPresent:
        typeof query.search_text === 'string' && query.search_text.length > 0,
    };
    report.pages.push(row);
    console.log(
      `Consultando ${row.collection}, pagina ${row.requestedPage}...`,
    );
    try {
      const body = await read(endpoint, query, options);
      const object = asObject(body);
      const pagination = asObject(object?.page_context);
      const items = object?.[row.collection];
      row.zohoCode = safeNumber(object?.code);
      row.itemCount = Array.isArray(items) ? items.length : null;
      row.reportedPage = safeNumber(pagination?.page);
      row.reportedPerPage = safeNumber(pagination?.per_page);
      row.hasMore =
        typeof pagination?.has_more_page === 'boolean'
          ? pagination.has_more_page
          : null;
      if (Array.isArray(items) && endpoint === '/contacts') {
        row.exactRutMatchesOnPage = items.filter(
          (item) =>
            typeof item?.contact_number === 'string' &&
            normalizeRut(item.contact_number) === rut,
        ).length;
      }
      if (Array.isArray(items) && endpoint === '/invoices') {
        row.matchingCustomerCount = items.filter(
          (item) =>
            row.customerIdFilterPresent &&
            item?.customer_id === query.customer_id,
        ).length;
      }
      return body;
    } catch (error) {
      Object.assign(row, describeError(error));
      throw error;
    }
  };

  const result = await service.findDebtByRutUsingContactFirst(rut);
  report.completed = true;
  report.contactFound = Boolean(result.contactFound);
  report.invoiceCount = safeNumber(result.invoiceCount);
  report.matchedContactsCount = safeNumber(result.matchedContactsCount);
}

main()
  .catch((error) => {
    report.failedStage = stage;
    Object.assign(report, describeError(error));
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
    report.apiReadRequests = apiReads;
    try {
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(JSON.stringify(report, null, 2));
      console.log(
        'Diagnostico guardado. No se accedio a la base local ni se crearon pagos.',
      );
    } catch {
      console.error('No se pudo guardar el archivo de diagnostico.');
      process.exitCode = 1;
    }
  });
