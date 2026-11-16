// Pruebas con dobles: sin .env, base de datos ni APIs externas.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = [
  resolve(__dirname, '../dist'),
  resolve(__dirname, '../dist/src'),
].find((p) =>
  existsSync(resolve(p, 'modules/zoho/zoho-customer-payments.service.js')),
);
assert.ok(root, 'Ejecuta npm run build primero.');
const { ZohoCustomerPaymentsService } = require(
  resolve(root, 'modules/zoho/zoho-customer-payments.service.js'),
);
const { normalizeRut } = require(resolve(root, 'common/utils/rut.util.js'));
const oldFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('HTTP_REAL_PROHIBIDO');
};
after(() => {
  globalThis.fetch = oldFetch;
});

function setup() {
  const payment = {
    id: 'local-test',
    customerId: 'customer-local',
    status: 'PAID',
    confirmationReviewRequired: false,
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
    mode: 'all',
    allowed: '11111111-1',
  };
  const config = {
    get: (key) =>
      ({
        ZOHO_WRITE_PAYMENTS_ENABLED: flags.write ? 'true' : 'false',
        ZOHO_PAYMENT_ALLOWED_RUTS: flags.allowed,
        ZOHO_PAYMENT_RUT_MODE: flags.mode,
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

for (const rut of ['11111111-1', '22222222-2']) {
  test(`all: sincroniza ${rut} aunque solo el primero figure en la lista`, async () => {
    const f = setup();
    f.payment.customer.rutNormalized = normalizeRut(rut);
    f.payment.customer.zohoCustomerId = `remote-${rut}`;
    f.invoice.customer_id = `remote-${rut}`;
    const result = await f.service.syncCustomerPaymentToZoho(f.payment.id);
    assert.equal(result.sentToZoho, true);
    assert.equal(f.calls.posts.length, 1);
    assert.equal(f.calls.posts[0].payload.customer_id, `remote-${rut}`);
    assert.equal(f.payment.zohoSyncStatus, 'SYNCED');
  });
}
for (const allowed of ['', undefined]) {
  test(`all explicito no depende de lista ${String(allowed)}`, async () => {
    const f = setup();
    f.flags.allowed = allowed;
    assert.equal(
      (await f.service.syncCustomerPaymentToZoho(f.payment.id)).sentToZoho,
      true,
    );
  });
}
for (const mode of ['allowlist', undefined]) {
  test(`${String(mode)}: preserva lista permitida`, async () => {
    const f = setup();
    f.flags.mode = mode;
    assert.equal(
      (await f.service.syncCustomerPaymentToZoho(f.payment.id)).sentToZoho,
      true,
    );
  });
  test(`${String(mode)}: bloquea un RUT fuera de la lista sin consultar ni enviar`, async () => {
    const f = setup();
    f.flags.mode = mode;
    f.payment.customer.rutNormalized = '22222222-2';
    await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
    assert.deepEqual(f.calls.order, []);
  });
  test(`${String(mode)}: lista vacia no abre todos los clientes`, async () => {
    const f = setup();
    f.flags.mode = mode;
    f.flags.allowed = '';
    await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
    assert.deepEqual(f.calls.order, []);
  });
}
for (const mode of ['', '*', 'ALL', 'invalid']) {
  test(`modo invalido ${JSON.stringify(mode)}: no reserva ni envia`, async () => {
    const f = setup();
    f.flags.mode = mode;
    await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
    assert.deepEqual(f.calls.order, []);
  });
}
test('all no permite pagos Mock', async () => {
  const f = setup();
  f.payment.khipuPaymentId = 'mock_123';
  await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.deepEqual(f.calls.order, []);
});
test('all no permite pagos sin confirmar', async () => {
  const f = setup();
  f.payment.status = 'PENDING';
  await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.deepEqual(f.calls.order, []);
});
test('all mantiene bloqueo de confirmacion en revision', async () => {
  const f = setup();
  f.payment.confirmationReviewRequired = true;
  await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.deepEqual(f.calls.order, []);
});
for (const status of ['SENDING', 'REVIEW_REQUIRED', 'SYNCED']) {
  test(`all no reinicia un ${status}`, async () => {
    const f = setup();
    f.payment.zohoSyncStatus = status;
    await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
    assert.deepEqual(f.calls.order, []);
  });
}
for (const [field, value] of [
  ['balance', 999],
  ['customer_id', 'other'],
  ['currency_code', 'USD'],
]) {
  test(`all mantiene prevalidacion de factura: ${field}`, async () => {
    const f = setup();
    f.invoice[field] = value;
    await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
    assert.equal(f.calls.posts.length, 0);
    assert.equal(f.calls.updates.length, 0);
  });
}
test('all no envia si pierde la reserva', async () => {
  const f = setup();
  f.flags.claimCount = 0;
  await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.equal(f.calls.posts.length, 0);
});
test('all conserva REVIEW_REQUIRED tras resultado incierto', async () => {
  const f = setup();
  f.flags.postFails = true;
  await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.equal(f.calls.posts.length, 1);
  assert.equal(f.payment.zohoSyncStatus, 'REVIEW_REQUIRED');
});
test('all no vuelve a enviar tras quedar SYNCED', async () => {
  const f = setup();
  await f.service.syncCustomerPaymentToZoho(f.payment.id);
  await assert.rejects(f.service.syncCustomerPaymentToZoho(f.payment.id));
  assert.equal(f.calls.posts.length, 1);
});
test('all respeta escritura desactivada', async () => {
  const f = setup();
  f.flags.write = false;
  const result = await f.service.syncCustomerPaymentToZoho(f.payment.id);
  assert.equal(result.sentToZoho, false);
  assert.equal(f.calls.posts.length, 0);
});
