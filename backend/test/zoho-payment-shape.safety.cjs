const assert = require('node:assert/strict');
const { test } = require('node:test');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const compiled = ['dist', 'dist/src']
  .map((dir) =>
    resolve(
      __dirname,
      '..',
      dir,
      'modules/zoho/utils/zoho-payment-reconciliation.util.js',
    ),
  )
  .find(existsSync);
assert.ok(compiled, 'Ejecuta npm run build desde backend.');
const { compareZohoPayment } = require(compiled);
const stored = {
  customer_id: 'customer-test',
  reference_number: 'reference-test',
  amount: 1000,
  date: '2026-11-03',
  description: 'description-test',
  invoices: [{ invoice_id: 'invoice-test', amount_applied: 1000 }],
};
function remote(format = 'books') {
  return {
    ...structuredClone(stored),
    payment_id: 'remote-test',
    currency_code: 'CLP',
    ...(format === 'books'
      ? { payment_status: 'paid', settlement_status: '', payment_refunds: [] }
      : { status: 'success', amount_refunded: 0 }),
  };
}
function compare(value) {
  return compareZohoPayment(stored, value, 'remote-test');
}
for (const format of ['books', 'legacy']) {
  test(`${format}: acepta detalle completo y no muta entradas`, () => {
    const value = remote(format);
    const before = structuredClone(value);
    assert.deepEqual(compare(value), []);
    assert.deepEqual(value, before);
  });
  for (const [key, value] of [
    ['status', 'void'],
    ['status', null],
    ['payment_status', 'refunded'],
    ['payment_status', null],
    ['amount_refunded', 1],
    ['amount_refunded', null],
    ['amount_refunded', undefined],
    ['amount_refunded', false],
    ['payment_refunds', [{}]],
    ['payment_refunds', null],
    ['payment_refunds', {}],
    ['settlement_status', 'pending'],
    ['settlement_status', null],
    ['payment_id', 'other'],
    ['customer_id', 'other'],
    ['reference_number', 'other'],
    ['amount', 999],
    ['currency_code', 'USD'],
    ['date', '2026-11-04'],
    ['description', 'other'],
    ['invoices', []],
    ['invoices', [{ invoice_id: 'invoice-test', amount_applied: 999 }]],
  ]) {
    test(`${format}: rechaza ${key}=${JSON.stringify(value)}`, () => {
      assert.ok(compare({ ...remote(format), [key]: value }).length > 0);
    });
  }
}
test('Books: no interpreta ausencia de payment_refunds como cero', () => {
  const value = remote();
  delete value.payment_refunds;
  assert.ok(compare(value).length > 0);
});
test('Legacy: no interpreta ausencia de amount_refunded como cero', () => {
  const value = remote('legacy');
  delete value.amount_refunded;
  assert.ok(compare(value).length > 0);
});
test('ambos formatos compatibles se aceptan', () => {
  assert.deepEqual(
    compare({ ...remote(), status: 'success', amount_refunded: '0.00' }),
    [],
  );
});
test('sin evidencia de estado: rechaza', () => {
  const value = remote();
  delete value.payment_status;
  assert.ok(compare(value).length > 0);
});
