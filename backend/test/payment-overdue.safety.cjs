const assert = require('node:assert/strict');
const { test: check } = require('node:test');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = [
  resolve(__dirname, '../dist'),
  resolve(__dirname, '../dist/src'),
].find((p) => existsSync(resolve(p, 'common/utils/debt-due-date.util.js')));
assert.ok(root, 'Ejecuta npm run build primero.');
const { getChileTodayDate, isDebtOverdue } = require(
  resolve(root, 'common/utils/debt-due-date.util.js'),
);
const { PaymentExpressService } = require(
  resolve(root, 'modules/payment-express/payment-express.service.js'),
);
const { PaymentsService } = require(
  resolve(root, 'modules/payments/payments.service.js'),
);
const { LocalCustomerDataProvider } = require(
  resolve(
    root,
    'modules/customer-data/provider/local-customer-data.provider.js',
  ),
);
const { ZohoCustomerDataProvider } = require(
  resolve(
    root,
    'modules/customer-data/provider/zoho-customer-data.provider.js',
  ),
);

check('fecha de Chile: no cambia al comenzar el dia UTC', () => {
  assert.equal(
    getChileTodayDate(new Date('2026-11-03T01:00:00Z')).toISOString(),
    '2026-11-02T00:00:00.000Z',
  );
  assert.equal(
    getChileTodayDate(new Date('2026-11-03T04:00:00Z')).toISOString(),
    '2026-11-03T00:00:00.000Z',
  );
  assert.equal(
    getChileTodayDate(new Date('2026-07-03T03:30:00Z')).toISOString(),
    '2026-07-02T00:00:00.000Z',
  );
});
check('ayer vencida; hoy, futura, nula e invalida no vencidas', () => {
  const today = new Date('2026-11-02T00:00:00Z');
  assert.equal(isDebtOverdue('2026-11-01', today), true);
  for (const value of ['2026-11-02', '2026-11-03', null, 'bad', '2026-02-30']) {
    assert.equal(isDebtOverdue(value, today), false);
  }
});
function setup() {
  let summary = {
    customerId: 'customer',
    totalDebt: 1800,
    overdueDebt: 800,
    canPay: true,
    currency: 'CLP',
  };
  const calls = [];
  let reads = 0;
  const provider = {
    getPaymentExpressSummaryByRut: async () => {
      reads++;
      return summary;
    },
  };
  const payments = {
    createPayment: async (dto, opts) => {
      calls.push({ dto, opts });
      return {
        reused: false,
        payment: {
          id: 'pay',
          amount: opts.expectedAmount,
          currency: 'CLP',
          status: 'PENDING',
          khipuPaymentUrl: 'https://example.test',
          expiresAt: null,
        },
      };
    },
  };
  return {
    service: new PaymentExpressService(provider, payments),
    calls,
    set: (value) => {
      summary = value;
    },
    reads: () => reads,
  };
}
const rut = { rut: '12.345.678-5' };
check(
  'resumen muestra ambos montos sin exponer documentos ni cliente',
  async () => {
    const s = setup();
    const result = await s.service.getSummary(rut);
    assert.equal(result.totalDebt, 1800);
    assert.equal(result.overdueDebt, 800);
    assert.equal(result.canPayOverdue, true);
    assert.equal('customerId' in result, false);
    assert.equal('documents' in result, false);
  },
);
check(
  'total y vencidas usan modalidades y montos diferentes; releen la fuente',
  async () => {
    const s = setup();
    await s.service.getSummary(rut);
    await s.service.payTotal(rut);
    await s.service.payOverdue(rut);
    assert.deepEqual(
      s.calls.map((c) => [c.dto.mode, c.opts.expectedAmount]),
      [
        ['TOTAL_DEBT', 1800],
        ['OVERDUE_DEBT', 800],
      ],
    );
    assert.equal(s.reads(), 3);
  },
);
check(
  'sin vencidas rechaza la creacion aunque exista deuda futura',
  async () => {
    const s = setup();
    s.set({
      customerId: 'customer',
      totalDebt: 1000,
      overdueDebt: 0,
      canPay: true,
      currency: 'CLP',
    });
    await assert.rejects(s.service.payOverdue(rut), /no posee deuda vencida/);
    assert.equal(s.calls.length, 0);
  },
);
check('fallo o ausencia de fuente no crea cobro', async () => {
  const s = setup();
  s.set(null);
  await assert.rejects(s.service.payOverdue(rut));
  assert.equal(s.calls.length, 0);
});
check('cambios de deuda se revalidan antes de pagar', async () => {
  const s = setup();
  await s.service.getSummary(rut);
  s.set({
    customerId: 'customer',
    totalDebt: 900,
    overdueDebt: 300,
    canPay: true,
    currency: 'CLP',
  });
  await s.service.payOverdue(rut);
  assert.equal(s.calls[0].opts.expectedAmount, 300);
});
check(
  'seleccion vencida exige fecha anterior y saldo, incluye parcialmente pagadas',
  async () => {
    let query;
    const service = new PaymentsService({}, {}, {}, {});
    await service.getDocumentsForPayment(
      { customerId: 'customer', mode: 'OVERDUE_DEBT' },
      {
        customerDocument: {
          findMany: async (value) => {
            query = value;
            return [];
          },
        },
      },
    );
    assert.equal(query.where.customerId, 'customer');
    assert.deepEqual(query.where.status.in, [
      'PENDING',
      'OVERDUE',
      'PARTIALLY_PAID',
    ]);
    assert.equal(query.where.outstandingAmount.gt, 0);
    assert.equal(
      query.where.dueDate.lt.toISOString(),
      getChileTodayDate().toISOString(),
    );
  },
);
check(
  'proveedor local suma saldo parcial vencido y excluye hoy y futuro',
  async () => {
    const today = getChileTodayDate();
    const yesterday = new Date(today.getTime() - 86400000);
    const provider = new LocalCustomerDataProvider({
      customer: {
        findUnique: async () => ({
          id: 'customer',
          documents: [
            { outstandingAmount: 300, currency: 'CLP', dueDate: yesterday },
            { outstandingAmount: 500, currency: 'CLP', dueDate: today },
            {
              outstandingAmount: 1000,
              currency: 'CLP',
              dueDate: new Date(today.getTime() + 86400000),
            },
          ],
        }),
      },
    });
    const result = await provider.getPaymentExpressSummaryByRut('12345678-5');
    assert.equal(result.totalDebt, 1800);
    assert.equal(result.overdueDebt, 300);
  },
);
check(
  'proveedor Zoho calcula vencidas desde fecha y saldo de factura parcial',
  async () => {
    const today = getChileTodayDate();
    const date = (days) =>
      new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
    const invoices = [
      {
        invoiceId: 'one',
        invoiceNumber: 'F1',
        dueDate: date(-1),
        balance: 300,
        total: 1000,
        currency: 'CLP',
        status: 'partially_paid',
      },
      {
        invoiceId: 'two',
        invoiceNumber: 'F2',
        dueDate: date(0),
        balance: 500,
        total: 500,
        currency: 'CLP',
        status: 'sent',
      },
      {
        invoiceId: 'three',
        invoiceNumber: 'F3',
        dueDate: date(1),
        balance: 1000,
        total: 1000,
        currency: 'CLP',
        status: 'sent',
      },
    ];
    const tx = {
      customer: { upsert: async () => ({ id: 'customer' }) },
      customerDocument: { upsert: async () => ({}), findMany: async () => [] },
    };
    const provider = new ZohoCustomerDataProvider(
      { $transaction: async (fn) => fn(tx) },
      {
        findDebtByRutUsingContactFirst: async () => ({
          contactFound: true,
          contact: { contactId: 'remote', contactName: 'Test' },
          invoices,
          totalDebt: 1800,
          currency: 'CLP',
        }),
      },
    );
    const result = await provider.getPaymentExpressSummaryByRut('12345678-5');
    assert.equal(result.totalDebt, 1800);
    assert.equal(result.overdueDebt, 300);
  },
);
check(
  'conflicto de reserva se propaga: no se crea ruta alternativa',
  async () => {
    let calls = 0;
    const service = new PaymentExpressService(
      {
        getPaymentExpressSummaryByRut: async () => ({
          customerId: 'customer',
          totalDebt: 1000,
          overdueDebt: 1000,
          canPay: true,
        }),
      },
      {
        createPayment: async () => {
          calls++;
          throw new Error('Conflicto de reserva');
        },
      },
    );
    await assert.rejects(service.payOverdue(rut), /Conflicto de reserva/);
    assert.equal(calls, 1);
  },
);
