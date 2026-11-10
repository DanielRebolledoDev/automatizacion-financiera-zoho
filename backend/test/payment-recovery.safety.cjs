const assert = require('node:assert/strict');
const { test: check } = require('node:test');
const { classify, recover } = require('../scripts/payment-recovery-policy.cjs');
function fixture() {
  const payment = {
    id: 'pay',
    status: 'PAID',
    amount: 1000,
    currency: 'CLP',
    khipuPaymentId: 'api_id',
    confirmationReviewRequired: false,
    zohoSyncStatus: 'NOT_SYNCED',
    zohoCustomerPaymentId: null,
    zohoSyncRemotePaymentId: null,
    zohoSyncAttemptId: null,
    zohoSyncStartedAt: null,
    zohoSyncOrganizationId: null,
    zohoSyncedAt: null,
    zohoSyncPayload: null,
    zohoSyncError: null,
  };
  const counts = { read: 0, api: 0, confirm: 0, send: 0, reconcile: 0 };
  const response = {
    payment_id: 'api_id',
    transaction_id: 'pay',
    amount: '1000.00',
    currency: 'CLP',
    status: 'done',
  };
  const args = {
    id: 'pay',
    action: 'send-zoho',
    confirmation: 'pay',
    env: { ZOHO_WRITE_PAYMENTS_ENABLED: 'true' },
    readPayment: async () => {
      counts.read++;
      return payment;
    },
    khipu: {
      getPaymentById: async () => {
        counts.api++;
        return { response };
      },
    },
    payments: {
      markPaymentAsPaidFromKhipuWebhook: async () => {
        counts.confirm++;
        return { payment: { status: 'PAID' }, alreadyProcessed: false };
      },
    },
    zoho: {
      syncCustomerPaymentToZoho: async () => {
        counts.send++;
        return { sentToZoho: true };
      },
      reconcileCustomerPayment: async () => {
        counts.reconcile++;
        return { outcome: 'NOT_FOUND', reconciled: false };
      },
    },
  };
  return { payment, counts, args, response };
}
check('plan no muta el registro', () => {
  const f = fixture(),
    before = structuredClone(f.payment);
  assert.equal(classify(f.payment).outcome, 'PAID_WITHOUT_ZOHO_ATTEMPT');
  assert.deepEqual(f.payment, before);
  assert.equal(f.counts.send, 0);
});
for (const status of ['SENDING', 'FAILED', 'SYNCED'])
  check(`${status}: nunca permite reenviar`, async () => {
    const f = fixture();
    f.payment.zohoSyncStatus = status;
    await assert.rejects(recover(f.args), /ACTION_BLOCKED/);
    assert.equal(f.counts.send, 0);
  });
check('revision de confirmacion bloquea cualquier accion', async () => {
  const f = fixture();
  f.payment.confirmationReviewRequired = true;
  for (const action of ['send-zoho', 'check-khipu', 'reconcile-zoho'])
    await assert.rejects(recover({ ...f.args, action }), /ACTION_BLOCKED/);
  assert.equal(
    f.counts.api + f.counts.confirm + f.counts.send + f.counts.reconcile,
    0,
  );
});
check('confirmacion explicita incorrecta: no lee ni actua', async () => {
  const f = fixture();
  await assert.rejects(
    recover({ ...f.args, confirmation: 'other' }),
    /CONFIRMATION_REQUIRED/,
  );
  assert.equal(f.counts.read, 0);
});
check('escritura apagada: no envia', async () => {
  const f = fixture();
  f.args.env.ZOHO_WRITE_PAYMENTS_ENABLED = 'false';
  await assert.rejects(recover(f.args), /ZOHO_WRITE_DISABLED/);
  assert.equal(f.counts.send, 0);
});
check(
  'PAID sin intento: delega al servicio con reserva persistente',
  async () => {
    const f = fixture();
    const result = await recover(f.args);
    assert.equal(result.sentToZoho, true);
    assert.equal(f.counts.send, 1);
    assert.equal(f.counts.api, 0);
  },
);
check(
  'cambio a SENDING desde el diagnostico: nueva lectura bloquea',
  async () => {
    const f = fixture();
    assert.ok(classify(f.payment).actions.includes('send-zoho'));
    f.payment.zohoSyncStatus = 'SENDING';
    await assert.rejects(recover(f.args));
    assert.equal(f.counts.send, 0);
  },
);
for (const field of [
  'zohoCustomerPaymentId',
  'zohoSyncRemotePaymentId',
  'zohoSyncAttemptId',
  'zohoSyncStartedAt',
  'zohoSyncPayload',
])
  check(`evidencia en ${field}: bloquea envio nuevo`, async () => {
    const f = fixture();
    f.payment[field] = 'evidence';
    await assert.rejects(recover(f.args));
    assert.equal(f.counts.send, 0);
  });
check('intento incierto: concilia sin reenviar ni liberar', async () => {
  const f = fixture();
  f.payment.zohoSyncStatus = 'REVIEW_REQUIRED';
  await assert.rejects(recover(f.args));
  const r = await recover({ ...f.args, action: 'reconcile-zoho' });
  assert.equal(r.resendAllowed, false);
  assert.equal(f.counts.reconcile, 1);
  assert.equal(f.counts.send, 0);
});
for (const status of ['PENDING', 'EXPIRED', 'CANCELLED'])
  check(
    `${status}: done puede delegar confirmacion sin llamar Zoho`,
    async () => {
      const f = fixture();
      f.payment.status = status;
      const r = await recover({ ...f.args, action: 'check-khipu' });
      assert.equal(r.status, 'PAID');
      assert.equal(f.counts.confirm, 1);
      assert.equal(f.counts.send, 0);
    },
  );
for (const status of ['pending', 'verifying'])
  check(`${status}: no cambia ni libera estado local`, async () => {
    const f = fixture();
    f.payment.status = 'EXPIRED';
    f.response.status = status;
    await recover({ ...f.args, action: 'check-khipu' });
    assert.equal(f.payment.status, 'EXPIRED');
    assert.equal(f.counts.confirm, 0);
  });
for (const patch of [
  { amount: '1000.4' },
  { transaction_id: 'other' },
  { currency: 'USD' },
  { payment_id: 'other' },
])
  check(
    `detalle incompatible ${JSON.stringify(patch)}: no confirma`,
    async () => {
      const f = fixture();
      f.payment.status = 'PENDING';
      Object.assign(f.response, patch);
      await assert.rejects(
        recover({ ...f.args, action: 'check-khipu' }),
        /KHIPU_DETAILS_MISMATCH/,
      );
      assert.equal(f.counts.confirm, 0);
    },
  );
for (const providerId of [null, 'mock_123', 'test_late_123'])
  check(`ID ${providerId}: sin operaciones externas`, async () => {
    const f = fixture();
    f.payment.khipuPaymentId = providerId;
    await assert.rejects(recover({ ...f.args, action: 'check-khipu' }));
    assert.equal(f.counts.api, 0);
  });
check('fallo de red no confirma ni envia', async () => {
  const f = fixture();
  f.payment.status = 'PENDING';
  f.args.khipu.getPaymentById = async () => {
    throw Error('network');
  };
  await assert.rejects(recover({ ...f.args, action: 'check-khipu' }));
  assert.equal(f.counts.confirm + f.counts.send, 0);
});

for (const status of [
  'CREATED',
  'PENDING',
  'IN_PROGRESS',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
]) {
  check(
    `deleted con estado local ${status}: informa sin cambiar ni enviar`,
    async () => {
      const f = fixture();
      f.payment.status = status;
      f.response.status = 'deleted';
      const before = structuredClone(f.payment);
      const result = await recover({ ...f.args, action: 'check-khipu' });
      assert.equal(result.outcome, 'KHIPU_DELETED');
      assert.equal(result.localStateChanged, false);
      assert.equal(result.requiresInspection, status !== 'CANCELLED');
      assert.deepEqual(f.payment, before);
      assert.equal(f.counts.confirm + f.counts.send + f.counts.reconcile, 0);
    },
  );
}
check('deleted no omite la validacion de identidad del pago', async () => {
  const f = fixture();
  f.payment.status = 'CANCELLED';
  f.response.status = 'deleted';
  f.response.transaction_id = 'other';
  await assert.rejects(
    recover({ ...f.args, action: 'check-khipu' }),
    /KHIPU_DETAILS_MISMATCH/,
  );
  assert.equal(f.counts.confirm + f.counts.send, 0);
});
check(
  'otros estados desconocidos siguen deteniendo la recuperacion',
  async () => {
    const f = fixture();
    f.payment.status = 'PENDING';
    f.response.status = 'unexpected';
    await assert.rejects(
      recover({ ...f.args, action: 'check-khipu' }),
      /KHIPU_UNKNOWN_STATUS/,
    );
    assert.equal(f.counts.confirm + f.counts.send, 0);
  },
);
