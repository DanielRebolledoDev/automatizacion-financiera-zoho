const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  prepare,
  apply,
  publicPlan,
} = require('../scripts/payment-review-resolution.cjs');
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
function fixture() {
  const doc = {
    id: 'doc',
    customerId: 'customer',
    currency: 'CLP',
    status: 'OVERDUE',
    outstandingAmount: 1000,
    updatedAt: new Date('2026-11-01'),
  };
  const rows = ids.map((id, i) => ({
    id,
    customerId: 'customer',
    mode: 'TOTAL_DEBT',
    status: i ? 'PENDING' : 'EXPIRED',
    amount: 1000,
    currency: 'CLP',
    paidAt: null,
    khipuPaymentId: `provider-${i}`,
    confirmationReviewRequired: true,
    confirmationReviewReason: 'OVERLAPPING_PAYMENT',
    zohoSyncStatus: 'NOT_SYNCED',
    updatedAt: new Date('2026-11-01'),
    ...Object.fromEntries(
      [
        'zohoCustomerPaymentId',
        'zohoSyncRemotePaymentId',
        'zohoSyncAttemptId',
        'zohoSyncStartedAt',
        'zohoSyncOrganizationId',
        'zohoSyncedAt',
        'zohoSyncPayload',
        'zohoSyncError',
      ].map((k) => [k, null]),
    ),
    documents: [
      { documentId: 'doc', amount: 1000, document: structuredClone(doc) },
    ],
  }));
  const state = { rows, events: [], attempts: [], doc };
  let reads = 0;
  let eventFailure = false;
  let beforeWrite;
  const tx = {
    $queryRaw: async () => [],
    payment: {
      findUnique: async ({ where }) =>
        structuredClone(state.rows.find((p) => p.id === where.id)),
      findMany: async () => structuredClone(state.rows),
      updateMany: async ({ where, data }) => {
        const p = state.rows.find((p) => p.id === where.id);
        if (p.status !== where.status || p.confirmationReviewRequired !== true)
          return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
    },
    customerDocument: {
      updateMany: async ({ data }) => {
        Object.assign(state.doc, data);
        return { count: 1 };
      },
    },
    paymentEvent: {
      findFirst: async () =>
        state.events.find((e) =>
          ['payment.paid.real', 'payment.paid.mock'].includes(e.eventType),
        ),
      create: async ({ data }) => {
        if (eventFailure) throw new Error('EVENT_FAILURE');
        state.events.push(data);
      },
    },
    paymentAttempt: { create: async ({ data }) => state.attempts.push(data) },
  };
  const db = {
    $transaction: async (fn, options) => {
      if (options.isolationLevel === 'ReadCommitted' && beforeWrite)
        beforeWrite();
      const snapshot = structuredClone(state);
      try {
        return await fn(tx);
      } catch (e) {
        Object.assign(state, snapshot);
        throw e;
      }
    },
  };
  const responses = rows.map((p, i) => ({
    payment_id: p.khipuPaymentId,
    transaction_id: p.id,
    amount: '1000.00',
    currency: 'CLP',
    status: i ? 'deleted' : 'done',
  }));
  const khipu = {
    getPaymentById: async (id) => {
      reads++;
      return {
        response: structuredClone(responses.find((r) => r.payment_id === id)),
      };
    },
  };
  return {
    db,
    khipu,
    state,
    responses,
    rows,
    reads: () => reads,
    failEvent: () => {
      eventFailure = true;
    },
    beforeWrite: (fn) => {
      beforeWrite = fn;
    },
  };
}
async function approval(f) {
  const p = await prepare(f.db, f.khipu, ids[0]);
  return {
    id: ids[0],
    confirm: ids[0],
    planHash: p.planHash,
    operator: 'tester',
    ticket: 'TEST-001',
  };
}
test('preview no modifica y no expone payloads', async () => {
  const f = fixture();
  const before = structuredClone(f.state);
  const plan = publicPlan(await prepare(f.db, f.khipu, ids[0]));
  assert.deepEqual(f.state, before);
  assert.equal(plan.amountAppliedOnce, 1000);
  assert.equal(plan.zohoSyncWillRun, false);
});
test('aplica saldo una vez, cancela eliminado y audita ambos; repetir se bloquea', async () => {
  const f = fixture();
  const input = await approval(f);
  await apply(f.db, f.khipu, input);
  assert.equal(f.state.doc.outstandingAmount, 0);
  assert.deepEqual(
    f.state.rows.map((r) => r.status),
    ['PAID', 'CANCELLED'],
  );
  assert.ok(f.state.rows.every((r) => !r.confirmationReviewRequired));
  assert.equal(
    f.state.events.filter((e) => e.eventType === 'payment.paid.real').length,
    1,
  );
  assert.equal(
    f.state.events.filter((e) => e.eventType === 'payment.review.resolved')
      .length,
    2,
  );
  await assert.rejects(apply(f.db, f.khipu, input), /GROUP_NOT_IN_REVIEW/);
  assert.equal(f.state.attempts.length, 2);
});
for (const [name, change] of [
  [
    'dos confirmados',
    (f) => {
      f.responses[1].status = 'done';
    },
  ],
  [
    'ningun confirmado',
    (f) => {
      f.responses[0].status = 'deleted';
    },
  ],
  [
    'verificando',
    (f) => {
      f.responses[1].status = 'verifying';
    },
  ],
  [
    'monto remoto distinto',
    (f) => {
      f.responses[0].amount = '999';
    },
  ],
  [
    'monto remoto decimal',
    (f) => {
      f.responses[0].amount = '1000.5';
    },
  ],
  [
    'moneda remota',
    (f) => {
      f.responses[0].currency = 'USD';
    },
  ],
  [
    'identidad local remota',
    (f) => {
      f.responses[0].transaction_id = ids[1];
    },
  ],
  [
    'saldo modificado',
    (f) => {
      f.rows[0].documents[0].document.outstandingAmount = 999;
    },
  ],
  [
    'facturas distintas',
    (f) => {
      f.rows[1].documents[0].documentId = 'other';
    },
  ],
  [
    'cliente distinto',
    (f) => {
      f.rows[1].customerId = 'other';
    },
  ],
  [
    'sin bloqueo',
    (f) => {
      f.rows[1].confirmationReviewRequired = false;
    },
  ],
  [
    'PAID previo',
    (f) => {
      f.rows[0].status = 'PAID';
    },
  ],
  [
    'fecha pago previa',
    (f) => {
      f.rows[0].paidAt = new Date();
    },
  ],
  [
    'Mock',
    (f) => {
      f.rows[0].khipuPaymentId = 'mock_123';
    },
  ],
  [
    'sintetico',
    (f) => {
      f.rows[0].khipuPaymentId = 'test_123';
    },
  ],
  [
    'SENDING',
    (f) => {
      f.rows[0].zohoSyncStatus = 'SENDING';
    },
  ],
  ...[
    'zohoCustomerPaymentId',
    'zohoSyncRemotePaymentId',
    'zohoSyncAttemptId',
    'zohoSyncStartedAt',
    'zohoSyncOrganizationId',
    'zohoSyncedAt',
    'zohoSyncPayload',
    'zohoSyncError',
  ].map((key) => [
    key,
    (f) => {
      f.rows[0][key] = 'evidence';
    },
  ]),
]) {
  test(`${name}: conserva bloqueo y saldos`, async () => {
    const f = fixture();
    change(f);
    const before = structuredClone(f.state);
    await assert.rejects(prepare(f.db, f.khipu, ids[0]));
    assert.deepEqual(f.state, before);
  });
}
test('sin aprobacion no lee ni consulta proveedor', async () => {
  await assert.rejects(
    apply({}, {}, { id: ids[0] }),
    /EXPLICIT_APPROVAL_REQUIRED/,
  );
});
test('plan cambia antes de aplicar: no escribe', async () => {
  const f = fixture();
  const input = await approval(f);
  f.rows[0].updatedAt = new Date('2026-11-02');
  await assert.rejects(apply(f.db, f.khipu, input), /PLAN_CHANGED/);
  assert.equal(f.state.doc.outstandingAmount, 1000);
});
test('cambio despues de consultar Khipu se detecta bajo bloqueo', async () => {
  const f = fixture();
  const input = await approval(f);
  f.beforeWrite(() => {
    f.rows[0].updatedAt = new Date('2026-11-02');
  });
  await assert.rejects(apply(f.db, f.khipu, input), /LOCAL_STATE_CHANGED/);
  assert.equal(f.state.doc.outstandingAmount, 1000);
});
test('fallo del evento revierte pagos y saldo en la transaccion simulada', async () => {
  const f = fixture();
  const input = await approval(f);
  f.failEvent();
  const before = structuredClone(f.state);
  await assert.rejects(apply(f.db, f.khipu, input), /EVENT_FAILURE/);
  assert.deepEqual(f.state, before);
});
test('evento PAID anterior impide reaplicar', async () => {
  const f = fixture();
  const input = await approval(f);
  f.state.events.push({ eventType: 'payment.paid.real' });
  await assert.rejects(apply(f.db, f.khipu, input), /PREVIOUS_PAID_EVENT/);
  assert.equal(f.state.doc.outstandingAmount, 1000);
});
