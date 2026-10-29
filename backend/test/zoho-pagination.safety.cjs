const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = [
  resolve(__dirname, '../dist'),
  resolve(__dirname, '../dist/src'),
].find((path) =>
  existsSync(resolve(path, 'modules/zoho/zoho-books.service.js')),
);
assert.ok(root, 'Ejecuta npm run build antes de estas pruebas.');
const { ZohoBooksService } = require(
  resolve(root, 'modules/zoho/zoho-books.service.js'),
);
const { ZohoCustomerDataProvider } = require(
  resolve(
    root,
    'modules/customer-data/provider/zoho-customer-data.provider.js',
  ),
);
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('Red real prohibida');
};
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkCalls, 0);
});

function invoice(id = 'i-1') {
  return {
    invoice_id: id,
    customer_id: 'c-1',
    currency_code: 'CLP',
    balance: 1000,
    total: 1000,
    status: 'sent',
  };
}
function page(items, hasMore = false, number = 1) {
  return {
    code: 0,
    invoices: items,
    page_context: { page: number, has_more_page: hasMore },
  };
}
function setup(responder) {
  const calls = [];
  const books = new ZohoBooksService(
    { get: (key) => (key === 'ZOHO_ORGANIZATION_ID' ? 'org-test' : undefined) },
    {
      getAccessToken: () => {
        throw new Error('OAuth real prohibido');
      },
    },
  );
  books.getFromBooks = async (path, params, options) => {
    calls.push({ path, params, options });
    return structuredClone(await responder(path, params));
  };
  return { books, calls };
}

test('lista completa: conserva todos los documentos y organización esperada', async () => {
  const f = setup((_path, params) =>
    params.page === 1
      ? page([invoice('a')], true, 1)
      : page([invoice('b')], false, 2),
  );
  const rows = await f.books.listUnpaidInvoicesByContactId('c-1');
  assert.deepEqual(
    rows.map((x) => x.invoice_id),
    ['a', 'b'],
  );
  assert.deepEqual(
    f.calls.map((x) => x.params.page),
    [1, 2],
  );
  assert.ok(
    f.calls.every((x) => x.options.expectedOrganizationId === 'org-test'),
  );
});
test('lista vacía explícitamente completa se acepta', async () => {
  const f = setup(() => page([]));
  assert.deepEqual(await f.books.listUnpaidInvoicesByContactId('c-1'), []);
});
for (const [label, response] of [
  ['code de error', { ...page([invoice()]), code: 57 }],
  ['respuesta null', null],
  ['arreglo ausente', { code: 0, page_context: { has_more_page: false } }],
  ['paginación ausente', { code: 0, invoices: [invoice()] }],
  [
    'booleano en texto',
    { ...page([invoice()]), page_context: { has_more_page: 'false' } },
  ],
  ['número de página incorrecto', page([invoice()], false, 2)],
  ['ID ausente', page([{ customer_id: 'c-1' }])],
  ['fila null', page([null])],
  ['ID repetido', page([invoice(), invoice()])],
  ['página vacía con más resultados', page([], true)],
  ['factura de otro cliente', page([{ ...invoice(), customer_id: 'other' }])],
]) {
  test(`${label}: rechaza en vez de devolver deuda parcial`, async () => {
    const f = setup(() => response);
    await assert.rejects(
      () => f.books.listUnpaidInvoicesByContactId('c-1'),
      (e) => e.getStatus() === 503,
    );
  });
}
test('límite de páginas alcanzado no devuelve el subconjunto', async () => {
  const f = setup((_path, params) =>
    page([invoice(`i-${params.page}`)], true, params.page),
  );
  await assert.rejects(
    () => f.books.listUnpaidInvoicesByContactId('c-1', 3),
    (e) => e.getStatus() === 503,
  );
  assert.equal(f.calls.length, 3);
});
test('última página completa en el límite sí se acepta', async () => {
  const f = setup((_path, params) =>
    page([invoice(`i-${params.page}`)], params.page < 3, params.page),
  );
  assert.equal(
    (await f.books.listUnpaidInvoicesByContactId('c-1', 3)).length,
    3,
  );
});
test('ID repetido entre páginas no suma la factura dos veces', async () => {
  const f = setup((_path, params) =>
    page([invoice()], params.page === 1, params.page),
  );
  await assert.rejects(
    () => f.books.listUnpaidInvoicesByContactId('c-1'),
    (e) => e.getStatus() === 503,
  );
});
test('error de red en segunda página no devuelve la primera', async () => {
  const f = setup((_path, params) => {
    if (params.page === 2) throw new Error('Timeout simulado');
    return page([invoice()], true);
  });
  await assert.rejects(
    () => f.books.listUnpaidInvoicesByContactId('c-1'),
    /Timeout simulado/,
  );
});
test('búsqueda de contactos incompleta tampoco devuelve coincidencias parciales', async () => {
  const f = setup((_path, params) => ({
    code: 0,
    contacts: [
      { contact_id: `c-${params.page}`, contact_number: '11111111-1' },
    ],
    page_context: { page: params.page, has_more_page: true },
  }));
  await assert.rejects(
    () => f.books.findContactsByRut('11111111-1'),
    (e) => e.getStatus() === 503,
  );
  assert.equal(f.calls.length, 50);
});
test('contactos completos se filtran por el RUT exacto', async () => {
  const f = setup(() => ({
    code: 0,
    contacts: [
      { contact_id: 'a', contact_number: '11.111.111-1' },
      { contact_id: 'b', contact_number: '22.222.222-2' },
    ],
    page_context: { page: 1, has_more_page: false },
  }));
  assert.deepEqual(
    (await f.books.findContactsByRut('11111111-1')).map((x) => x.contact_id),
    ['a'],
  );
});
test('consulta general de impagas aplica el mismo bloqueo', async () => {
  const f = setup(() => page([invoice()], true));
  await assert.rejects(
    () => f.books.listUnpaidInvoices({ maxPages: 1 }),
    (e) => e.getStatus() === 503,
  );
});
test('muestra administrativa puede ser parcial y lo declara', async () => {
  const f = setup(() => page([invoice()], true));
  const sample = await f.books.listUnpaidInvoicesForDebug();
  assert.equal(sample.isPartial, true);
  assert.equal(sample.count, 1);
  assert.equal(f.calls.length, 1);
});
test('consulta debug completa tiene límite en lugar de bucle ilimitado', async () => {
  const f = setup((_path, params) =>
    page([invoice(`i-${params.page}`)], true, params.page),
  );
  await assert.rejects(
    () => f.books.listInvoicesByContactIdForDebug('c-1'),
    (e) => e.getStatus() === 503,
  );
  assert.equal(f.calls.length, 20);
});
test('límite inválido se rechaza antes de consultar', async () => {
  const f = setup(() => page([]));
  await assert.rejects(
    () => f.books.listUnpaidInvoicesByContactId('c-1', 0),
    (e) => e.getStatus() === 400,
  );
  assert.equal(f.calls.length, 0);
});
test('flujo real del proveedor: deuda parcial no alcanza la transacción local', async () => {
  let transactions = 0;
  const f = setup((path, params) =>
    path === '/contacts'
      ? {
          code: 0,
          contacts: [{ contact_id: 'c-1', contact_number: '11111111-1' }],
          page_context: { page: 1, has_more_page: false },
        }
      : page([invoice(`i-${params.page}`)], true, params.page),
  );
  const provider = new ZohoCustomerDataProvider(
    {
      $transaction: () => {
        transactions += 1;
        throw new Error('No debía escribir');
      },
    },
    f.books,
  );
  await assert.rejects(
    () => provider.getPaymentExpressSummaryByRut('11111111-1'),
    (e) => e.getStatus() === 503,
  );
  assert.equal(transactions, 0);
  assert.equal(f.calls.filter((x) => x.path === '/invoices').length, 20);
});
