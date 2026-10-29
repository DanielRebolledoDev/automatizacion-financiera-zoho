// Ejecuta código compilado con dependencias simuladas; no carga .env ni inicia Nest.
const assert = require('node:assert/strict');
const { test, afterEach, after } = require('node:test');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = [
  resolve(__dirname, '../dist'),
  resolve(__dirname, '../dist/src'),
].find((p) =>
  existsSync(resolve(p, 'modules/zoho/zoho-customer-payments.service.js')),
);
assert.ok(root, 'Ejecuta npm run build antes de estas pruebas.');
const { ZohoCustomerPaymentsService } = require(
  resolve(root, 'modules/zoho/zoho-customer-payments.service.js'),
);
const { ZohoBooksService } = require(
  resolve(root, 'modules/zoho/zoho-books.service.js'),
);
const { ZohoAuthService } = require(
  resolve(root, 'modules/zoho/zoho-auth.service.js'),
);
const { normalizeRut } = require(resolve(root, 'common/utils/rut.util.js'));
const originalFetch = globalThis.fetch;
const denyNetwork = () => {
  throw new Error('Red real prohibida en estas pruebas');
};
globalThis.fetch = denyNetwork;
afterEach(() => {
  globalThis.fetch = denyNetwork;
});
after(() => {
  globalThis.fetch = originalFetch;
});

function setup() {
  const payment = {
    id: 'local-test',
    customerId: 'customer-local',
    status: 'PAID',
    amount: 1000,
    currency: 'CLP',
    paidAt: new Date('2026-10-20T12:00:00Z'),
    updatedAt: new Date('2026-10-20T12:00:00Z'),
    khipuPaymentId: 'real-test',
    zohoSyncStatus: 'NOT_SYNCED',
    zohoSyncAttemptId: null,
    zohoSyncOrganizationId: null,
    zohoSyncRemotePaymentId: null,
    zohoCustomerPaymentId: null,
    customer: {
      zohoCustomerId: 'remote-customer',
      rutNormalized: normalizeRut('11111111-1'),
    },
    documents: [
      {
        amount: 1000,
        document: {
          customerId: 'customer-local',
          documentType: 'INVOICE',
          currency: 'CLP',
          totalAmount: 1000,
          zohoDocumentId: 'invoice-test',
          documentNumber: 'TEST-1',
        },
      },
    ],
  };
  const invoice = {
    invoice_id: 'invoice-test',
    customer_id: 'remote-customer',
    currency_code: 'CLP',
    status: 'sent',
    total: 1000,
    balance: 1000,
  };
  const calls = { reads: [], posts: [], updates: [], order: [] };
  const flags = {
    claimCount: 1,
    readFails: false,
    postFails: false,
    write: true,
  };
  const config = {
    get: (key) =>
      ({
        ZOHO_WRITE_PAYMENTS_ENABLED: flags.write ? 'true' : 'false',
        ZOHO_PAYMENT_ALLOWED_RUTS: '11111111-1',
      })[key],
  };
  const prisma = {
    payment: {
      findUnique: () => Promise.resolve(structuredClone(payment)),
      updateMany: (args) => {
        calls.updates.push(structuredClone(args));
        calls.order.push('update');
        const count =
          args.data.zohoSyncStatus === 'SENDING' ? flags.claimCount : 1;
        if (count === 1) Object.assign(payment, structuredClone(args.data));
        return Promise.resolve({ count });
      },
    },
  };
  const books = {
    getOrganizationId: () => 'org-test',
    getFromBooks: (path, params, options) => {
      calls.reads.push({ path, params, options });
      calls.order.push('read');
      if (flags.readFails) return Promise.reject(new Error('Timeout simulado'));
      return Promise.resolve({ code: 0, invoice: structuredClone(invoice) });
    },
    postToBooks: (path, payload, params, organizationId) => {
      calls.posts.push({ path, payload, params, organizationId });
      calls.order.push('post');
      if (flags.postFails)
        return Promise.reject(new Error('Resultado incierto simulado'));
      return Promise.resolve({
        code: 0,
        payment: { payment_id: 'remote-payment' },
      });
    },
  };
  return {
    payment,
    invoice,
    calls,
    flags,
    service: new ZohoCustomerPaymentsService(prisma, config, books),
  };
}

test('envío simulado: consulta factura, reserva organización, envía y confirma', async () => {
  const f = setup();
  const result = await f.service.syncCustomerPaymentToZoho(f.payment.id);
  assert.equal(result.sentToZoho, true);
  assert.deepEqual(f.calls.order, ['read', 'update', 'post', 'update']);
  assert.equal(f.calls.reads[0].options.expectedOrganizationId, 'org-test');
  assert.equal(f.calls.updates[0].data.zohoSyncOrganizationId, 'org-test');
  assert.equal(f.calls.posts[0].organizationId, 'org-test');
  assert.equal(f.payment.zohoSyncStatus, 'SYNCED');
});
for (const [field, value] of [
  ['balance', 999],
  ['balance', 0],
  ['balance', undefined],
  ['balance', 'NaN'],
  ['balance', 1000.5],
  ['total', 0],
  ['total', 999],
  ['invoice_id', 'other'],
  ['customer_id', 'other'],
  ['currency_code', 'USD'],
  ['status', 'draft'],
  ['status', 'void'],
  ['status', 'paid'],
  ['status', 'unknown'],
]) {
  test(`prevalidación rechaza ${field}=${JSON.stringify(value)} antes de reservar o enviar`, async () => {
    const f = setup();
    f.invoice[field] = value;
    await assert.rejects(
      () => f.service.syncCustomerPaymentToZoho(f.payment.id),
      (e) => e.getStatus() === 409,
    );
    assert.equal(f.calls.updates.length, 0);
    assert.equal(f.calls.posts.length, 0);
    assert.equal(f.payment.zohoSyncStatus, 'NOT_SYNCED');
  });
}
test('saldo y total expresados como enteros decimales en texto se aceptan', async () => {
  const f = setup();
  f.invoice.balance = '1000.00';
  f.invoice.total = '1000.00';
  await f.service.syncCustomerPaymentToZoho(f.payment.id);
  assert.equal(f.calls.posts.length, 1);
});
test('error consultando factura: no reserva ni envía', async () => {
  const f = setup();
  f.flags.readFails = true;
  await assert.rejects(() => f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.calls.posts.length, 0);
});
test('reserva perdida: no envía aunque las facturas sean válidas', async () => {
  const f = setup();
  f.flags.claimCount = 0;
  await assert.rejects(
    () => f.service.syncCustomerPaymentToZoho(f.payment.id),
    (e) => e.getStatus() === 409,
  );
  assert.equal(f.calls.posts.length, 0);
});
test('error después de reservar: conserva organización y bloquea en REVIEW_REQUIRED', async () => {
  const f = setup();
  f.flags.postFails = true;
  await assert.rejects(() => f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.equal(f.payment.zohoSyncStatus, 'REVIEW_REQUIRED');
  assert.equal(f.payment.zohoSyncOrganizationId, 'org-test');
  assert.equal(f.calls.posts.length, 1);
  await assert.rejects(() => f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.equal(f.calls.posts.length, 1);
});
test('Mock con escritura activada en el doble: no consulta ni envía', async () => {
  const f = setup();
  f.payment.khipuPaymentId = 'mock_test';
  await assert.rejects(
    () => f.service.syncCustomerPaymentToZoho(f.payment.id),
    (e) => e.getStatus() === 403,
  );
  assert.equal(f.calls.reads.length, 0);
  assert.equal(f.calls.posts.length, 0);
});
test('escritura desactivada: mantiene dry-run sin consultar Zoho', async () => {
  const f = setup();
  f.flags.write = false;
  const result = await f.service.syncCustomerPaymentToZoho(f.payment.id);
  assert.equal(result.dryRun, true);
  assert.equal(result.sentToZoho, false);
  assert.equal(f.calls.reads.length, 0);
  assert.equal(f.calls.posts.length, 0);
});

function authConfig() {
  return {
    get: (key) =>
      ({
        ZOHO_CLIENT_ID: 'fake-id',
        ZOHO_CLIENT_SECRET: 'fake-secret',
        ZOHO_REFRESH_TOKEN: 'fake-refresh',
        ZOHO_ACCOUNTS_BASE_URL: 'https://accounts.example.invalid/',
        ZOHO_BOOKS_BASE_URL: 'https://books.example.invalid/v3',
        ZOHO_ORGANIZATION_ID: 'org-test',
      })[key],
  };
}
test('OAuth: dos solicitudes concurrentes comparten renovación y luego caché', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://accounts.example.invalid/oauth/v2/token');
    assert.ok(options.signal instanceof AbortSignal);
    return {
      ok: true,
      json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
    };
  };
  const auth = new ZohoAuthService(authConfig());
  assert.deepEqual(
    await Promise.all([auth.getAccessToken(), auth.getAccessToken()]),
    ['fake-token', 'fake-token'],
  );
  assert.equal(await auth.getAccessToken(), 'fake-token');
  assert.equal(calls, 1);
  auth.clearCachedToken();
  await auth.getAccessToken();
  assert.equal(calls, 2);
});
test('OAuth: token de duración corta no queda almacenado más allá de su vida', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ access_token: 'fake', expires_in: 30 }),
    };
  };
  const auth = new ZohoAuthService(authConfig());
  await auth.getAccessToken();
  await auth.getAccessToken();
  assert.equal(calls, 2);
});
test('OAuth: error de red no expone secretos ni deja renovación bloqueada', async () => {
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return Promise.reject(new Error('fake-secret'));
  };
  const auth = new ZohoAuthService(authConfig());
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(
      () => auth.getAccessToken(),
      (e) => e.getStatus() === 503 && !e.message.includes('fake-secret'),
    );
  }
  assert.equal(calls, 2);
});
test('OAuth: duración inválida rechazada', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ access_token: 'fake', expires_in: 'invalid' }),
  });
  await assert.rejects(
    () => new ZohoAuthService(authConfig()).getAccessToken(),
    (e) => e.getStatus() === 503,
  );
});
test('Books: organización diferente bloquea GET y POST antes de fetch', async () => {
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    throw new Error('No debía llegar');
  };
  const books = new ZohoBooksService(authConfig(), {
    getAccessToken: async () => 'fake',
  });
  await assert.rejects(
    () =>
      books.getFromBooks(
        '/invoices/x',
        {},
        { expectedOrganizationId: 'other' },
      ),
    (e) => e.getStatus() === 409,
  );
  await assert.rejects(
    () => books.postToBooks('/customerpayments', {}, {}, 'other'),
    (e) => e.getStatus() === 409,
  );
  assert.equal(calls, 0);
});
test('Books: parámetros no pueden sustituir organización', async () => {
  const books = new ZohoBooksService(authConfig(), {
    getAccessToken: async () => 'fake',
  });
  await assert.rejects(
    () => books.getFromBooks('/invoices/x', { organization_id: 'other' }),
    (e) => e.getStatus() === 400,
  );
  await assert.rejects(
    () =>
      books.postToBooks('/customerpayments', {}, { organization_id: 'other' }),
    (e) => e.getStatus() === 400,
  );
});
test('Books: transmite organización esperada y tiempo límite con GET y POST simulados', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    assert.equal(url.searchParams.get('organization_id'), 'org-test');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ code: 0 }) };
  };
  const books = new ZohoBooksService(authConfig(), {
    getAccessToken: async () => 'fake',
  });
  await books.getFromBooks(
    '/invoices/x',
    {},
    { expectedOrganizationId: 'org-test' },
  );
  await books.postToBooks('/customerpayments', {}, {}, 'org-test');
  assert.deepEqual(calls, ['GET', 'POST']);
});
