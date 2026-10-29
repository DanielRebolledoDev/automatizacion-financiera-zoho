// Regresiones 37D: servicio compilado, respuestas simuladas, sin .env ni DB/red.
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
  throw new Error('Red real prohibida en las regresiones 37D.');
};
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkCalls, 0);
});

const RUT = '11111111-1';
const nextTurn = () => new Promise((done) => setImmediate(done));
function deferred() {
  let resolvePromise;
  const promise = new Promise((done) => {
    resolvePromise = done;
  });
  return { promise, resolve: resolvePromise };
}
function contact(id, rut = RUT, receivable = 0) {
  return {
    contact_id: id,
    contact_number: rut,
    contact_name: `Cliente ${id}`,
    contact_type: 'customer',
    outstanding_receivable_amount: receivable,
  };
}
function invoice(id, customerId, balance = 1000) {
  return {
    invoice_id: id,
    invoice_number: id,
    customer_id: customerId,
    currency_code: 'CLP',
    balance,
    total: balance,
    status: 'sent',
  };
}
function page(collection, items, number = 1, hasMore = false) {
  return {
    code: 0,
    [collection]: items,
    page_context: { page: number, per_page: 200, has_more_page: hasMore },
  };
}
function cataloguePage(number, matchingPages = [], lastPage = 6) {
  const rows = Array.from({ length: 200 }, (_, i) =>
    contact(`other-${number}-${i}`, '22222222-2'),
  );
  if (matchingPages.includes(number)) {
    rows[7] = contact(`matched-${number}`, '11.111.111-1');
  }
  return page('contacts', rows, number, number < lastPage);
}
function setup(responder, configOverrides = {}) {
  const calls = [];
  const config = {
    ZOHO_ORGANIZATION_ID: 'org-test',
    ZOHO_BOOKS_BASE_URL: 'https://www.zohoapis.com/books/v3',
    ...configOverrides,
  };
  const books = new ZohoBooksService(
    { get: (key) => config[key] },
    {
      getAccessToken: () => {
        throw new Error('OAuth real prohibido');
      },
    },
  );
  books.getFromBooks = async (path, params, options) => {
    calls.push({ path, params: { ...params }, options });
    return structuredClone(await responder(path, params, options));
  };
  return { books, calls, config };
}
function guardedProvider(books) {
  let transactions = 0;
  const provider = new ZohoCustomerDataProvider(
    {
      $transaction: () => {
        transactions += 1;
        throw new Error('No debía alcanzar una transacción local');
      },
    },
    books,
  );
  return { provider, transactions: () => transactions };
}
function incomplete(reason) {
  return (error) => {
    assert.equal(error.getStatus?.(), 503);
    const response = error.getResponse();
    assert.equal(response.code, 'ZOHO_READ_INCOMPLETE');
    assert.equal(response.reason, reason);
    return true;
  };
}
function conflict(error) {
  assert.equal(error.getStatus?.(), 409);
  assert.equal(error.getResponse().code, 'ZOHO_MULTIPLE_DEBT_CONTACTS');
  return true;
}

test('RUT después de 1000 contactos: completa la sexta página y normaliza la entrada', async () => {
  const f = setup((_path, params) => cataloguePage(params.page, [6]));
  const matches = await f.books.findContactsByRut(' 11.111.111-1 ');
  assert.deepEqual(
    matches.map((item) => item.contact_id),
    ['matched-6'],
  );
  assert.equal(f.calls.length, 6);
  for (const call of f.calls) {
    assert.equal(call.path, '/contacts');
    assert.equal(call.params.contact_type, 'customer');
    assert.equal(Object.hasOwn(call.params, 'search_text'), false);
    assert.equal(call.options.expectedOrganizationId, 'org-test');
  }
});

test('coincidencias en páginas 3 y 6: conserva ambas y no corta en la primera', async () => {
  const f = setup((_path, params) => cataloguePage(params.page, [3, 6]));
  const matches = await f.books.findContactsByRut(RUT);
  assert.deepEqual(
    matches.map((item) => item.contact_id),
    ['matched-3', 'matched-6'],
  );
  assert.equal(f.calls.length, 6);
});

test('no consulta facturas hasta completar todas las páginas de contactos', async () => {
  let contactReads = 0;
  const f = setup((path, params) => {
    if (path === '/contacts') {
      contactReads += 1;
      return cataloguePage(params.page, [3, 6]);
    }
    assert.equal(contactReads, 6);
    return page(
      'invoices',
      params.customer_id === 'matched-6'
        ? [invoice('payable', 'matched-6')]
        : [],
    );
  });
  const result = await f.books.findDebtByRutUsingContactFirst(RUT);
  assert.equal(result.matchedContactsCount, 2);
  assert.equal(result.selectedContactId, 'matched-6');
  assert.equal(result.totalDebt, 1000);
  assert.equal(f.calls.filter((call) => call.path === '/invoices').length, 2);
  assert.ok(
    f.calls.every((call) => call.options.expectedOrganizationId === 'org-test'),
  );
});

test('consulta completa sin coincidencias: devuelve ausencia solo al final', async () => {
  const f = setup((path, params) => {
    assert.equal(path, '/contacts');
    return cataloguePage(params.page, []);
  });
  const p = guardedProvider(f.books);
  assert.equal(await p.provider.getPaymentExpressSummaryByRut(RUT), null);
  assert.equal(f.calls.length, 6);
  assert.equal(p.transactions(), 0);
});

test('límite configurado: una coincidencia parcial no permite consultar facturas ni sincronizar', async () => {
  const f = setup(
    (path, params) => {
      assert.equal(path, '/contacts');
      return cataloguePage(params.page, [3], 7);
    },
    { ZOHO_CONTACTS_MAX_PAGES: '6' },
  );
  const p = guardedProvider(f.books);
  await assert.rejects(
    () => p.provider.getPaymentExpressSummaryByRut(RUT),
    incomplete('PAGE_LIMIT_REACHED'),
  );
  assert.equal(f.calls.length, 6);
  assert.equal(p.transactions(), 0);
});

test('última página completa justo en el límite configurado se acepta', async () => {
  const f = setup((_path, params) => cataloguePage(params.page, [6]), {
    ZOHO_CONTACTS_MAX_PAGES: '6',
  });
  assert.equal((await f.books.findContactsByRut(RUT)).length, 1);
  assert.equal(f.calls.length, 6);
});

test('fallo de lectura en página 6: descarta las coincidencias anteriores', async () => {
  const f = setup((path, params) => {
    assert.equal(path, '/contacts');
    if (params.page === 6)
      throw new Error('Fallo de lectura simulado en página 6');
    return cataloguePage(params.page, [3]);
  });
  const p = guardedProvider(f.books);
  await assert.rejects(
    () => p.provider.getPaymentExpressSummaryByRut(RUT),
    /Fallo de lectura simulado/,
  );
  assert.equal(f.calls.length, 6);
  assert.equal(p.transactions(), 0);
});

test('ID repetido en página 6: rechaza la búsqueda completa', async () => {
  const f = setup((_path, params) => {
    const result = cataloguePage(params.page, [3]);
    if (params.page === 6) result.contacts[0].contact_id = 'other-1-0';
    return result;
  });
  await assert.rejects(
    () => f.books.findContactsByRut(RUT),
    (error) => error.getStatus?.() === 503,
  );
  assert.equal(f.calls.length, 6);
});

test('facturas: el flujo principal completa más de tres páginas', async () => {
  const f = setup((path, params) =>
    path === '/contacts'
      ? page('contacts', [contact('c-1')])
      : page(
          'invoices',
          [invoice(`invoice-${params.page}`, 'c-1')],
          params.page,
          params.page < 4,
        ),
  );
  const result = await f.books.findDebtByRutUsingContactFirst(RUT);
  assert.equal(result.invoiceCount, 4);
  assert.equal(result.totalDebt, 4000);
  assert.equal(f.calls.filter((call) => call.path === '/invoices').length, 4);
});

test('facturas: el límite configurado se respeta sin cerrar saldos locales', async () => {
  const f = setup(
    (path, params) =>
      path === '/contacts'
        ? page('contacts', [contact('c-1')])
        : page(
            'invoices',
            [invoice(`invoice-${params.page}`, 'c-1')],
            params.page,
            true,
          ),
    { ZOHO_INVOICES_MAX_PAGES: '2' },
  );
  const p = guardedProvider(f.books);
  await assert.rejects(
    () => p.provider.getPaymentExpressSummaryByRut(RUT),
    incomplete('PAGE_LIMIT_REACHED'),
  );
  assert.equal(f.calls.filter((call) => call.path === '/invoices').length, 2);
  assert.equal(p.transactions(), 0);
});

test('duplicado histórico sin deuda y un contacto con deuda: evalúa ambos y conserva el pagable', async () => {
  const evaluated = [];
  const f = setup((path, params) => {
    if (path === '/contacts') {
      return page('contacts', [
        contact('payable', RUT, 1000),
        contact('historical', RUT, 0),
      ]);
    }
    evaluated.push(params.customer_id);
    return page(
      'invoices',
      params.customer_id === 'payable' ? [invoice('only-debt', 'payable')] : [],
    );
  });
  const result = await f.books.findDebtByRutUsingContactFirst(RUT);
  assert.deepEqual(evaluated, ['payable', 'historical']);
  assert.equal(result.selectedContactId, 'payable');
  assert.equal(result.matchedContactsCount, 2);
  assert.equal(result.totalDebt, 1000);
  assert.equal(result.invoiceCount, 1);
  assert.equal(result.candidateContacts.length, 2);
});

test('dos contactos con deuda para un RUT: devuelve conflicto y no sincroniza', async () => {
  const f = setup((path, params) =>
    path === '/contacts'
      ? page('contacts', [contact('a', RUT, 2000), contact('b', RUT, 1000)])
      : page('invoices', [
          invoice(`debt-${params.customer_id}`, params.customer_id),
        ]),
  );
  const p = guardedProvider(f.books);
  await assert.rejects(
    () => p.provider.getPaymentExpressSummaryByRut(RUT),
    conflict,
  );
  assert.equal(f.calls.filter((call) => call.path === '/invoices').length, 2);
  assert.equal(p.transactions(), 0);
});

test('segundo contacto ilegible: no devuelve la deuda del primero', async () => {
  const f = setup((path, params) => {
    if (path === '/contacts') {
      return page('contacts', [
        contact('a', RUT, 2000),
        contact('b', RUT, 1000),
      ]);
    }
    if (params.customer_id === 'b')
      throw new Error('Segundo contacto inaccesible');
    return page('invoices', [invoice('debt-a', 'a')]);
  });
  const p = guardedProvider(f.books);
  await assert.rejects(
    () => p.provider.getPaymentExpressSummaryByRut(RUT),
    /Segundo contacto inaccesible/,
  );
  assert.equal(p.transactions(), 0);
});

test('todos los contactos sin deuda: cero se confirma después de evaluar cada candidato', async () => {
  const f = setup((path) =>
    path === '/contacts'
      ? page('contacts', [contact('a'), contact('b')])
      : page('invoices', []),
  );
  const result = await f.books.findDebtByRutUsingContactFirst(RUT);
  assert.equal(result.contactFound, true);
  assert.equal(result.canPay, false);
  assert.equal(result.totalDebt, 0);
  assert.equal(result.invoiceCount, 0);
  assert.equal(result.matchedContactsCount, 2);
  assert.equal(result.candidateContacts.length, 2);
  assert.equal(f.calls.filter((call) => call.path === '/invoices').length, 2);
});

test('100 GET es un presupuesto compartido entre contactos y todos sus candidatos', async () => {
  const f = setup(
    (path, params) =>
      path === '/contacts'
        ? page('contacts', [contact('a', RUT, 2000), contact('b', RUT, 1000)])
        : page(
            'invoices',
            [
              invoice(
                `${params.customer_id}-${params.page}`,
                params.customer_id,
              ),
            ],
            params.page,
            params.page < 50,
          ),
    { ZOHO_INVOICES_MAX_PAGES: '100' },
  );
  const p = guardedProvider(f.books);
  await assert.rejects(
    () => p.provider.getPaymentExpressSummaryByRut(RUT),
    incomplete('REQUEST_LIMIT_REACHED'),
  );
  assert.equal(f.calls.length, 100);
  assert.equal(f.calls.filter((call) => call.path === '/contacts').length, 1);
  assert.equal(
    f.calls.filter((call) => call.params.customer_id === 'a').length,
    50,
  );
  assert.equal(
    f.calls.filter((call) => call.params.customer_id === 'b').length,
    49,
  );
  assert.equal(p.transactions(), 0);
});

test('lectura completa exactamente en el GET número 100 se acepta', async () => {
  const f = setup(
    (path, params) =>
      path === '/contacts'
        ? page('contacts', [contact('a')])
        : page(
            'invoices',
            [invoice(`a-${params.page}`, 'a')],
            params.page,
            params.page < 99,
          ),
    { ZOHO_INVOICES_MAX_PAGES: '100' },
  );
  const result = await f.books.findDebtByRutUsingContactFirst(RUT);
  assert.equal(result.invoiceCount, 99);
  assert.equal(f.calls.length, 100);
});

for (const [key, invalidValues, method] of [
  ['ZOHO_CONTACTS_MAX_PAGES', ['0', '101', '1.5', 'abc'], 'contacts'],
  ['ZOHO_INVOICES_MAX_PAGES', ['0', '101', '2.5', 'abc'], 'invoices'],
  ['ZOHO_DEBT_READ_TIMEOUT_MS', ['0', '120001', '1.5', 'abc'], 'contacts'],
]) {
  for (const value of invalidValues) {
    test(`${key}=${value}: configuración inválida falla antes de leer`, async () => {
      const f = setup(
        () => {
          throw new Error('No debía consultar con configuración inválida');
        },
        { [key]: value },
      );
      await assert.rejects(
        () =>
          method === 'contacts'
            ? f.books.findContactsByRut(RUT)
            : f.books.listUnpaidInvoicesByContactId('c-1'),
        (error) => {
          assert.equal(error.getStatus?.(), 503);
          assert.equal(error.getResponse().code, 'ZOHO_READ_CONFIG_INVALID');
          return true;
        },
      );
      assert.equal(f.calls.length, 0);
    });
  }
}

test('cambio de organización durante contactos: no mezcla páginas ni consulta facturas', async () => {
  const f = setup((_path, params) => {
    f.config.ZOHO_ORGANIZATION_ID = 'org-changed';
    return cataloguePage(params.page, [1]);
  });
  const p = guardedProvider(f.books);
  await assert.rejects(
    () => p.provider.getPaymentExpressSummaryByRut(RUT),
    (error) => error.getStatus?.() === 409,
  );
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.expectedOrganizationId, 'org-test');
  assert.equal(p.transactions(), 0);
});

test('cambio de organización tras la última factura: no sincroniza una lectura obsoleta', async () => {
  const f = setup((path) => {
    if (path === '/contacts') return page('contacts', [contact('a')]);
    f.config.ZOHO_ORGANIZATION_ID = 'org-changed';
    return page('invoices', [invoice('debt-a', 'a')]);
  });
  const p = guardedProvider(f.books);
  await assert.rejects(
    () => p.provider.getPaymentExpressSummaryByRut(RUT),
    (error) => error.getStatus?.() === 409,
  );
  assert.equal(f.calls.length, 2);
  assert.ok(
    f.calls.every((call) => call.options.expectedOrganizationId === 'org-test'),
  );
  assert.equal(p.transactions(), 0);
});

test('deadline durante contactos: una respuesta tardía no inicia facturas ni transacciones', async () => {
  const late = deferred();
  const f = setup(() => late.promise, { ZOHO_DEBT_READ_TIMEOUT_MS: '20' });
  const p = guardedProvider(f.books);
  try {
    await assert.rejects(
      () => p.provider.getPaymentExpressSummaryByRut(RUT),
      incomplete('TIME_LIMIT_REACHED'),
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.signal.aborted, true);
  } finally {
    late.resolve(page('contacts', [contact('a')]));
  }
  await nextTurn();
  await nextTurn();
  assert.equal(f.calls.length, 1);
  assert.equal(p.transactions(), 0);
});

test('deadline compartido hasta el último candidato: una factura tardía no sincroniza', async () => {
  const late = deferred();
  const f = setup(
    (path, params) => {
      if (path === '/contacts') {
        return page('contacts', [
          contact('a', RUT, 2000),
          contact('b', RUT, 1000),
        ]);
      }
      return params.customer_id === 'a' ? page('invoices', []) : late.promise;
    },
    { ZOHO_DEBT_READ_TIMEOUT_MS: '20' },
  );
  const p = guardedProvider(f.books);
  try {
    await assert.rejects(
      () => p.provider.getPaymentExpressSummaryByRut(RUT),
      incomplete('TIME_LIMIT_REACHED'),
    );
    assert.equal(f.calls.length, 3);
    const signal = f.calls[0].options.signal;
    assert.ok(f.calls.every((call) => call.options.signal === signal));
    assert.equal(signal.aborted, true);
  } finally {
    late.resolve(page('invoices', [invoice('debt-b', 'b')]));
  }
  await nextTurn();
  await nextTurn();
  assert.equal(p.transactions(), 0);
});

test('transporte: una señal ya abortada impide iniciar OAuth', async () => {
  let oauthCalls = 0;
  const books = new ZohoBooksService(
    { get: () => undefined },
    {
      getAccessToken: async () => {
        oauthCalls += 1;
        return 'fake-token';
      },
    },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() =>
    books.getFromBooks(
      '/contacts',
      {},
      {
        signal: controller.signal,
      },
    ),
  );
  assert.equal(oauthCalls, 0);
});

test('transporte: abortar durante OAuth impide el GET posterior', async () => {
  const oauth = deferred();
  let oauthCalls = 0;
  const books = new ZohoBooksService(
    {
      get: (key) =>
        ({
          ZOHO_ORGANIZATION_ID: 'org-test',
          ZOHO_BOOKS_BASE_URL: 'https://www.zohoapis.com/books/v3',
        })[key],
    },
    {
      getAccessToken: () => {
        oauthCalls += 1;
        return oauth.promise;
      },
    },
  );
  const controller = new AbortController();
  const request = books.getFromBooks(
    '/contacts',
    {},
    {
      signal: controller.signal,
      expectedOrganizationId: 'org-test',
    },
  );
  assert.equal(oauthCalls, 1);
  controller.abort();
  oauth.resolve('fake-token');
  await assert.rejects(() => request);
  assert.equal(networkCalls, 0);
});
