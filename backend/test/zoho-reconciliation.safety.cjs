// Pruebas aisladas: NO inicia Nest, NO crea PrismaClient, NO carga .env.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = () => {
  networkAttempts += 1;
  throw new Error('La red está prohibida en estas pruebas.');
};
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0, 'El servicio intentó acceder a la red real');
});

const candidates = [
  resolve(__dirname, '../dist/modules/zoho/zoho-customer-payments.service.js'),
  resolve(
    __dirname,
    '../dist/src/modules/zoho/zoho-customer-payments.service.js',
  ),
];
const compiledPath = candidates.find(existsSync);
assert.ok(
  compiledPath,
  'No se encontró el servicio compilado. Ejecuta npm run build desde backend.',
);
const { ZohoCustomerPaymentsService } = require(compiledPath);

function fixture() {
  // Todos los identificadores y montos son ficticios.
  const id = '11111111-1111-4111-8111-111111111111';
  const snapshot = {
    customer_id: 'customer-test',
    payment_mode: 'banktransfer',
    amount: 1000,
    date: '2026-10-20',
    reference_number: 'khipu-test-reference',
    description: `Pago registrado desde Portal Pago Express. Pago local: ${id}`,
    invoices: [{ invoice_id: 'invoice-test', amount_applied: 1000 }],
  };
  const payment = {
    id,
    amount: 1000,
    currency: 'CLP',
    status: 'PAID',
    khipuPaymentId: snapshot.reference_number,
    updatedAt: new Date('2026-10-20T12:00:00Z'),
    zohoSyncStatus: 'REVIEW_REQUIRED',
    zohoSyncAttemptId: 'attempt-test',
    zohoSyncOrganizationId: 'organization-test',
    zohoCustomerPaymentId: null,
    zohoSyncRemotePaymentId: null,
    zohoSyncPayload: structuredClone(snapshot),
  };
  const remote = {
    ...structuredClone(snapshot),
    payment_id: 'remote-test',
    currency_code: 'CLP',
    status: 'success',
    amount_refunded: 0,
  };
  const row = {
    payment_id: remote.payment_id,
    customer_id: snapshot.customer_id,
    reference_number: snapshot.reference_number,
  };
  const calls = { reads: [], posts: 0, updates: [], events: [] };
  const options = { count: 1, eventFailure: false };
  let list = {
    code: 0,
    customerpayments: [row],
    page_context: { has_more_page: false },
  };
  let readError = null;
  let responseCode = 0;
  const updateMany = (args) => {
    calls.updates.push(structuredClone(args));
    if (options.count === 1) Object.assign(payment, structuredClone(args.data));
    return Promise.resolve({ count: options.count });
  };
  const prisma = {
    payment: {
      findUnique: () => Promise.resolve(structuredClone(payment)),
      updateMany,
    },
    $transaction: async (callback) => {
      // Simulación de rollback; no sustituye una prueba transaccional en MySQL.
      const before = structuredClone(payment);
      const eventsBefore = calls.events.length;
      try {
        return await callback({
          payment: { updateMany },
          paymentEvent: {
            create: (args) => {
              if (options.eventFailure)
                throw new Error('Fallo simulado al guardar evento');
              calls.events.push(structuredClone(args));
              return Promise.resolve(args.data);
            },
          },
        });
      } catch (error) {
        for (const key of Object.keys(payment)) delete payment[key];
        Object.assign(payment, before);
        calls.events.length = eventsBefore;
        throw error;
      }
    },
  };
  const books = {
    getOrganizationId: () => 'organization-test',
    getFromBooks: (path, params) => {
      calls.reads.push({ path, params });
      if (readError) return Promise.reject(readError);
      return Promise.resolve(
        structuredClone(
          path === '/customerpayments'
            ? list
            : { code: responseCode, payment: remote },
        ),
      );
    },
    postToBooks: () => {
      calls.posts += 1;
      throw new Error('POST remoto prohibido en esta prueba');
    },
  };
  // true únicamente en este doble de configuración en memoria:
  // permite verificar que ni siquiera así se reenvíe un intento incierto.
  const config = {
    get: (key) => (key === 'ZOHO_WRITE_PAYMENTS_ENABLED' ? 'true' : undefined),
  };
  const service = new ZohoCustomerPaymentsService(prisma, config, books);
  return {
    id,
    payment,
    remote,
    row,
    calls,
    options,
    service,
    setList: (value) => {
      list = value;
    },
    failRead: () => {
      readError = new Error('Timeout simulado');
    },
    failDetail: () => {
      responseCode = 99;
    },
  };
}

async function expectBlocked(f, outcome, expectedReads) {
  const before = structuredClone(f.payment);
  const result = await f.service.reconcileCustomerPayment(f.id);
  assert.equal(result.outcome, outcome);
  assert.equal(result.reconciled, false);
  assert.equal(result.remoteWriteAttempted, false);
  assert.equal(result.resendAllowed, false);
  assert.equal(f.calls.posts, 0);
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.calls.events.length, 0);
  assert.deepEqual(f.payment, before);
  if (expectedReads !== undefined)
    assert.equal(f.calls.reads.length, expectedReads);
  return result;
}

test('coincidencia completa: confirma localmente y no repite al conciliar otra vez', async () => {
  const f = fixture();
  const result = await f.service.reconcileCustomerPayment(f.id);
  assert.equal(result.outcome, 'RECONCILED');
  assert.equal(result.reconciled, true);
  assert.equal(result.remoteWriteAttempted, false);
  assert.equal(result.resendAllowed, false);
  assert.equal(f.payment.zohoSyncStatus, 'SYNCED');
  assert.equal(f.payment.zohoCustomerPaymentId, 'remote-test');
  assert.equal(f.calls.updates.length, 1);
  assert.equal(f.calls.events.length, 1);
  assert.equal(f.calls.events[0].data.eventType, 'zoho.payment.reconciled');
  assert.equal(f.calls.updates[0].where.zohoSyncStatus, 'REVIEW_REQUIRED');
  assert.equal(f.calls.updates[0].where.zohoSyncAttemptId, 'attempt-test');
  assert.ok(f.calls.updates[0].where.updatedAt instanceof Date);
  const second = await f.service.reconcileCustomerPayment(f.id);
  assert.equal(second.outcome, 'ALREADY_SYNCED');
  assert.equal(f.calls.reads.length, 2);
  assert.equal(f.calls.updates.length, 1);
  assert.equal(f.calls.events.length, 1);
  assert.equal(f.calls.posts, 0);
});

for (const [label, mutate, outcome] of [
  [
    'Mock',
    (f) => {
      f.payment.khipuPaymentId = 'mock_test';
    },
    'MOCK_NOT_APPLICABLE',
  ],
  [
    'reserva activa',
    (f) => {
      f.payment.zohoSyncStatus = 'SENDING';
    },
    'SENDING_REQUIRES_INSPECTION',
  ],
  [
    'fallo antiguo',
    (f) => {
      f.payment.zohoSyncStatus = 'FAILED';
    },
    'LEGACY_REQUIRES_INSPECTION',
  ],
  [
    'sin intento incierto',
    (f) => {
      f.payment.zohoSyncStatus = 'DRY_RUN_READY';
    },
    'NO_UNCERTAIN_ATTEMPT',
  ],
  [
    'sin ID de intento',
    (f) => {
      f.payment.zohoSyncAttemptId = null;
    },
    'INCONSISTENT_LOCAL_STATE',
  ],
  [
    'snapshot inválido',
    (f) => {
      f.payment.zohoSyncPayload = {};
    },
    'INVALID_SNAPSHOT',
  ],
]) {
  test(`${label}: no consulta Zoho ni modifica el pago`, async () => {
    const f = fixture();
    mutate(f);
    await expectBlocked(f, outcome, 0);
  });
}

test('no encontrado: conserva el bloqueo de reenvío', async () => {
  const f = fixture();
  f.setList({
    code: 0,
    customerpayments: [],
    page_context: { has_more_page: false },
  });
  await expectBlocked(f, 'NOT_FOUND', 1);
});
test('duplicados: exige revisión manual', async () => {
  const f = fixture();
  f.setList({
    code: 0,
    customerpayments: [f.row, { ...f.row, payment_id: 'other' }],
    page_context: { has_more_page: false },
  });
  await expectBlocked(f, 'MULTIPLE_MATCHES', 1);
});
test('sin paginación: no confirma con una búsqueda incompleta', async () => {
  const f = fixture();
  f.setList({ code: 0, customerpayments: [f.row] });
  await expectBlocked(f, 'INCOMPLETE_SEARCH', 1);
});
test('límite de cinco páginas: conserva el bloqueo', async () => {
  const f = fixture();
  f.setList({
    code: 0,
    customerpayments: [f.row],
    page_context: { has_more_page: true },
  });
  await expectBlocked(f, 'INCOMPLETE_SEARCH', 5);
  assert.deepEqual(
    f.calls.reads.map((call) => call.params.page),
    [1, 2, 3, 4, 5],
  );
});
test('ID remoto guardado distinto: no consulta ni acepta el detalle candidato', async () => {
  const f = fixture();
  f.payment.zohoSyncRemotePaymentId = 'different';
  await expectBlocked(f, 'REMOTE_ID_MISMATCH', 1);
});

for (const [field, value] of [
  ['amount', 999],
  ['currency_code', 'USD'],
  ['customer_id', 'other'],
  ['reference_number', 'other'],
  ['date', '2026-10-21'],
  ['description', 'other'],
  ['status', 'void'],
  ['amount_refunded', 1],
  ['amount_refunded', undefined],
  ['invoices', [{ invoice_id: 'other', amount_applied: 1000 }]],
]) {
  test(`detalle incompatible (${field}=${JSON.stringify(value)}): no concilia`, async () => {
    const f = fixture();
    f.remote[field] = value;
    const result = await expectBlocked(f, 'DATA_MISMATCH', 2);
    assert.ok(result.differences.length > 0);
  });
}

for (const [label, configure] of [
  ['timeout', (f) => f.failRead()],
  ['detalle con error de Zoho', (f) => f.failDetail()],
]) {
  test(`${label}: no confirma ni envía otro pago`, async () => {
    const f = fixture();
    configure(f);
    await assert.rejects(() => f.service.reconcileCustomerPayment(f.id));
    assert.equal(f.payment.zohoSyncStatus, 'REVIEW_REQUIRED');
    assert.equal(f.calls.updates.length, 0);
    assert.equal(f.calls.events.length, 0);
    assert.equal(f.calls.posts, 0);
  });
}
test('estado cambiado durante la consulta: rechaza guardar la conciliación', async () => {
  const f = fixture();
  f.options.count = 0;
  await assert.rejects(
    () => f.service.reconcileCustomerPayment(f.id),
    (error) => error.getStatus() === 409,
  );
  assert.equal(f.payment.zohoSyncStatus, 'REVIEW_REQUIRED');
  assert.equal(f.calls.events.length, 0);
  assert.equal(f.calls.posts, 0);
});
test('fallo al guardar evento: propaga el error y usa la transacción', async () => {
  const f = fixture();
  f.options.eventFailure = true;
  await assert.rejects(
    () => f.service.reconcileCustomerPayment(f.id),
    /Fallo simulado/,
  );
  assert.equal(f.payment.zohoSyncStatus, 'REVIEW_REQUIRED');
  assert.equal(f.payment.zohoCustomerPaymentId, null);
  assert.equal(f.calls.events.length, 0);
  assert.equal(f.calls.posts, 0);
});
for (const status of ['SENDING', 'REVIEW_REQUIRED']) {
  test(`${status}: ni dry-run ni sync permiten reiniciar el intento`, async () => {
    const f = fixture();
    f.payment.zohoSyncStatus = status;
    await assert.rejects(
      () => f.service.buildCustomerPaymentDryRun(f.id),
      (error) => error.getStatus() === 409,
    );
    await assert.rejects(
      () => f.service.syncCustomerPaymentToZoho(f.id),
      (error) => error.getStatus() === 409,
    );
    assert.equal(f.calls.updates.length, 0);
    assert.equal(f.calls.posts, 0);
    assert.equal(f.calls.reads.length, 0);
  });
}

for (const [org, outcome] of [
  [null, 'ORGANIZATION_NOT_RECORDED'],
  ['another-organization', 'ORGANIZATION_MISMATCH'],
]) {
  test(`${outcome}: no consulta otra organización ni libera el intento`, async () => {
    const f = fixture();
    f.payment.zohoSyncOrganizationId = org;
    await expectBlocked(f, outcome, 0);
  });
}
