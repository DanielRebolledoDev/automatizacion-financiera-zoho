const assert = require('node:assert/strict');
const { test } = require('node:test');
const { inspect } = require('../scripts/payment-review.cjs');
const id = '11111111-1111-4111-8111-111111111111';
function fixture(count = 1) {
  const p = {
    id,
    status: 'EXPIRED',
    amount: 1000,
    currency: 'CLP',
    khipuPaymentId: 'provider-id',
    confirmationReviewRequired: true,
    confirmationReviewReason: 'OVERLAPPING_PAYMENT',
    zohoSyncStatus: 'NOT_SYNCED',
    zohoSyncPayload: { secret: 'SECRET_PAYLOAD' },
    zohoSyncError: 'SECRET_ERROR',
    documents: [
      {
        documentId: 'doc',
        amount: 1000,
        document: {
          status: 'PENDING',
          outstandingAmount: 1000,
          currency: 'CLP',
        },
      },
    ],
  };
  const calls = [];
  const tx = {
    payment: {
      findUnique: async () => {
        calls.push('read');
        return p;
      },
      findMany: async (query) => {
        assert.equal(query.where.documents.some.documentId.in[0], 'doc');
        return Array.from({ length: count }, () => ({ ...p, id: 'related' }));
      },
    },
    paymentEvent: { findMany: async () => [] },
    paymentAttempt: { findMany: async () => [] },
  };
  const db = {
    $transaction: async (fn, options) => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return fn(tx);
    },
  };
  return { db, p, calls, tx };
}
test('revision conserva bloqueo y no expone payload ni errores', async () => {
  const f = fixture();
  const before = structuredClone(f.p);
  const result = await inspect(f.db, id);
  assert.deepEqual(f.p, before);
  assert.equal(result.mutationPerformed, false);
  assert.deepEqual(result.payment.recoveryPlan.actions, []);
  assert.equal(result.relatedPayments.length, 1);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.equal(result.payment.providerKind, 'API_ENVIRONMENT_UNVERIFIED');
});
test('limite visible: no presenta un expediente truncado como completo', async () => {
  const result = await inspect(fixture(51).db, id);
  assert.equal(result.truncated.relatedPayments, true);
  assert.equal(result.relatedPayments.length, 50);
});
test('UUID invalido no consulta DB', async () => {
  await assert.rejects(inspect({}, 'invalid'), /INVALID_PAYMENT_ID/);
});
test('pago inexistente devuelve found false', async () => {
  const f = fixture();
  f.tx.payment.findUnique = async () => null;
  assert.equal((await inspect(f.db, id)).found, false);
});
test('sin documentos no busca pagos relacionados', async () => {
  const f = fixture();
  f.p.documents = [];
  f.tx.payment.findMany = async () => {
    throw new Error('UNEXPECTED');
  };
  assert.deepEqual((await inspect(f.db, id)).relatedPayments, []);
});
