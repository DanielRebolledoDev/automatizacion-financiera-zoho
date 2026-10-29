// Pruebas del servicio compilado. Base de datos y Khipu simulados; sin .env.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const root = [
  resolve(__dirname, '../dist'),
  resolve(__dirname, '../dist/src'),
].find((p) => existsSync(resolve(p, 'modules/payments/payments.service.js')));
assert.ok(root, 'Ejecuta npm run build antes de estas pruebas.');
const { PaymentsService } = require(
  resolve(root, 'modules/payments/payments.service.js'),
);
const { KhipuService } = require(
  resolve(root, 'modules/khipu/khipu.service.js'),
);
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('Red real prohibida');
};
after(() => {
  globalThis.fetch = originalFetch;
});
const dto = { customerId: 'customer', mode: 'TOTAL_DEBT' };
const status = (code) => (error) => error.getStatus?.() === code;
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
};

function setup() {
  let state = {
    customer: { id: 'customer', rut: 'test', businessName: 'Test' },
    documents: [
      {
        id: 'doc1',
        customerId: 'customer',
        outstandingAmount: 1000,
        currency: 'CLP',
        status: 'PENDING',
      },
    ],
    payments: [],
    attempts: [],
    events: [],
  };
  const flags = {};
  const calls = { posts: [], locks: 0, isolation: [], inTransaction: false };
  const config = {
    KHIPU_PROVIDER: 'mock',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    PUBLIC_BACKEND_URL: 'http://localhost:3000',
  };
  let queue = Promise.resolve();
  const withDocuments = (payment) => ({
    ...structuredClone(payment),
    documents: payment.documentIds.map((id) => ({
      documentId: id,
      document: structuredClone(state.documents.find((d) => d.id === id)),
    })),
  });
  const tx = {
    $queryRaw: async (strings, customerId) => {
      assert.match(
        strings.join('?'),
        /SELECT id FROM customers\s+WHERE id = \? FOR UPDATE/,
      );
      assert.equal(customerId, dto.customerId);
      calls.locks++;
      return state.customer ? [{ id: customerId }] : [];
    },
    customer: {
      findUniqueOrThrow: async () => structuredClone(state.customer),
    },
    customerDocument: {
      findMany: async ({ where }) =>
        structuredClone(
          state.documents.filter(
            (d) =>
              d.customerId === where.customerId &&
              d.outstandingAmount > 0 &&
              (!where.id || where.id.in.includes(d.id)) &&
              (typeof where.status === 'string'
                ? d.status === where.status
                : where.status.in.includes(d.status)),
          ),
        ),
    },
    payment: {
      findMany: async ({ where }) =>
        state.payments
          .filter(
            (p) =>
              p.customerId === where.customerId &&
              where.status.in.includes(p.status) &&
              p.documentIds.some((id) =>
                where.documents.some.documentId.in.includes(id),
              ),
          )
          .map(withDocuments),
      create: async ({ data }) => {
        const payment = {
          ...data,
          id: randomUUID(),
          khipuPaymentId: null,
          khipuPaymentUrl: null,
          expiresAt: null,
          updatedAt: new Date(),
          documentIds: [],
        };
        state.payments.push(payment);
        return structuredClone(payment);
      },
      updateMany: async ({ where, data }) => {
        const payment = state.payments.find((p) => p.id === where.id);
        if (
          !payment ||
          payment.status !== where.status ||
          ('khipuPaymentId' in where &&
            payment.khipuPaymentId !== where.khipuPaymentId) ||
          ('khipuPaymentUrl' in where &&
            payment.khipuPaymentUrl !== where.khipuPaymentUrl) ||
          (where.updatedAt &&
            payment.updatedAt.getTime() !== where.updatedAt.getTime())
        )
          return { count: 0 };
        Object.assign(payment, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }) =>
        withDocuments(state.payments.find((p) => p.id === where.id)),
    },
    paymentDocument: {
      createMany: async ({ data }) => {
        for (const d of data)
          state.payments
            .find((p) => p.id === d.paymentId)
            .documentIds.push(d.documentId);
        return { count: data.length };
      },
    },
    paymentAttempt: {
      create: async ({ data }) => {
        if (flags.reservationFailure) throw new Error('DB reservation failed');
        const attempt = { ...data, id: randomUUID() };
        state.attempts.push(attempt);
        return structuredClone(attempt);
      },
      update: async ({ where, data }) => {
        if (flags.saveFailure && data.status === 'PENDING')
          throw new Error('DB attach failed');
        Object.assign(
          state.attempts.find((a) => a.id === where.id),
          data,
        );
      },
    },
    paymentEvent: {
      create: async ({ data }) => {
        if (flags.diagnosticFailure) throw new Error('DB diagnostic failed');
        state.events.push(data);
      },
    },
  };
  const prisma = {
    $transaction: async (callback, options) => {
      const previous = queue;
      const gate = deferred();
      queue = gate.promise;
      await previous;
      calls.inTransaction = true;
      const snapshot = structuredClone(state);
      try {
        if (options) calls.isolation.push(options.isolationLevel);
        return await callback(tx);
      } catch (error) {
        state = snapshot;
        throw error;
      } finally {
        calls.inTransaction = false;
        gate.resolve();
      }
    },
  };
  const khipu = {
    createPayment: async (params) => {
      assert.equal(
        calls.inTransaction,
        false,
        'No mantener transacción abierta durante el POST',
      );
      assert.ok(
        state.attempts.some((a) => a.paymentId === params.localPaymentId),
        'Reserva e intento antes del POST',
      );
      calls.posts.push(params);
      if (flags.onPost) await flags.onPost(params);
      if (flags.networkFailure) throw new Error('Timeout');
      return {
        paymentId: `${config.KHIPU_PROVIDER === 'mock' ? 'mock_' : 'real_'}${params.localPaymentId}`,
        paymentUrl: 'https://checkout.example.test/payment',
        expiresAt: new Date(Date.now() + 3600000),
      };
    },
  };
  const service = () =>
    new PaymentsService(prisma, khipu, { get: (key) => config[key] }, {});
  const seed = (overrides = {}) => {
    const row = {
      id: randomUUID(),
      customerId: 'customer',
      mode: 'TOTAL_DEBT',
      amount: 1000,
      currency: 'CLP',
      status: 'PENDING',
      documentIds: ['doc1'],
      updatedAt: new Date(),
      khipuPaymentId: `mock_${randomUUID()}`,
      khipuPaymentUrl: 'https://checkout.example.test/old',
      expiresAt: null,
      ...overrides,
    };
    state.payments.push(row);
    return row;
  };
  return { state: () => state, flags, calls, config, service, seed };
}

test('crea reserva e intento antes de Khipu, fuera de la transacción, y adjunta una vez', async () => {
  const s = setup();
  const result = await s.service().createPayment(dto);
  assert.equal(result.reused, false);
  assert.equal(result.payment.status, 'PENDING');
  assert.equal(s.state().payments.length, 1);
  assert.equal(s.state().attempts.length, 1);
  assert.equal(s.state().attempts[0].status, 'PENDING');
  assert.deepEqual(s.calls.isolation, ['ReadCommitted']);
  assert.equal(s.calls.locks, 1);
});
test('20 solicitudes y dos instancias: un POST; las otras 19 reciben reserva ocupada', async () => {
  const s = setup();
  const entered = deferred();
  const release = deferred();
  s.flags.onPost = async () => {
    entered.resolve();
    await release.promise;
  };
  const a = s.service();
  const b = s.service();
  const first = a.createPayment(dto);
  await entered.promise;
  try {
    const others = await Promise.allSettled(
      Array.from({ length: 19 }, (_, i) => (i % 2 ? a : b).createPayment(dto)),
    );
    assert.ok(
      others.every((r) => r.status === 'rejected' && status(409)(r.reason)),
    );
    assert.equal(s.calls.posts.length, 1);
    assert.equal(s.state().payments.length, 1);
  } finally {
    release.resolve();
  }
  await first;
});
test('una instancia nueva reutiliza el pago completo sin POST adicional', async () => {
  const s = setup();
  const first = await s.service().createPayment(dto);
  const next = await s.service().createPayment(dto);
  assert.equal(next.reused, true);
  assert.equal(next.payment.id, first.payment.id);
  assert.equal(s.calls.posts.length, 1);
});
test('timeout: conserva CREATED, registra revisión y una nueva instancia no reenvía', async () => {
  const s = setup();
  s.flags.networkFailure = true;
  await assert.rejects(s.service().createPayment(dto), status(503));
  assert.equal(s.state().payments[0].status, 'CREATED');
  assert.equal(
    s.state().events[0].eventType,
    'payment.creation.review_required',
  );
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 1);
});
test('respuesta recibida y persistencia fallida: guarda ID observado sin reenviar', async () => {
  const s = setup();
  s.flags.saveFailure = true;
  await assert.rejects(s.service().createPayment(dto), status(503));
  assert.equal(s.state().payments[0].khipuPaymentId, null);
  assert.match(
    s.state().attempts[0].responsePayload.observedPaymentId,
    /^mock_/,
  );
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 1);
});
test('fallo también al guardar diagnóstico: la reserva sigue bloqueando', async () => {
  const s = setup();
  s.flags.networkFailure = true;
  s.flags.diagnosticFailure = true;
  await assert.rejects(s.service().createPayment(dto), status(503));
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 1);
});
test('CREATED antiguo sin identificador: no intenta repararlo reenviando', async () => {
  const s = setup();
  s.seed({ status: 'CREATED', khipuPaymentId: null, khipuPaymentUrl: null });
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 0);
});
test('cobro de otro proveedor no se reutiliza ni se duplica', async () => {
  const s = setup();
  s.seed({ khipuPaymentId: 'real-old' });
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 0);
});
test('saldo distinto para una factura reservada bloquea un nuevo cobro', async () => {
  const s = setup();
  s.seed({ amount: 900 });
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 0);
});
test('selección parcialmente superpuesta bloquea un segundo cobro', async () => {
  const s = setup();
  s.seed();
  s.state().documents.push({ ...s.state().documents[0], id: 'doc2' });
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 0);
});
test('dos cobros activos heredados exigen revisión, sin elegir uno arbitrariamente', async () => {
  const s = setup();
  s.seed();
  s.seed();
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 0);
});
test('factura ya pagada que reaparece pendiente no puede cobrarse nuevamente', async () => {
  const s = setup();
  s.seed({ status: 'PAID' });
  await assert.rejects(s.service().createPayment(dto), status(409));
  assert.equal(s.calls.posts.length, 0);
});
test('Mock vencido se expira y permite una nueva reserva', async () => {
  const s = setup();
  const old = s.seed({ expiresAt: new Date(0) });
  await s.service().createPayment(dto);
  assert.equal(
    s.state().payments.find((p) => p.id === old.id).status,
    'EXPIRED',
  );
  assert.equal(s.calls.posts.length, 1);
});
test('IN_PROGRESS no se libera por fecha vencida', async () => {
  const s = setup();
  s.seed({ status: 'IN_PROGRESS', expiresAt: new Date(0) });
  assert.equal((await s.service().createPayment(dto)).reused, true);
  assert.equal(s.calls.posts.length, 0);
});
for (const state of ['CANCELLED', 'EXPIRED', 'FAILED']) {
  test(`registro ${state} no impide crear una reserva nueva`, async () => {
    const s = setup();
    s.seed({ status: state });
    assert.equal((await s.service().createPayment(dto)).reused, false);
    assert.equal(s.calls.posts.length, 1);
  });
}
test('cliente inexistente no genera cobro', async () => {
  const s = setup();
  s.state().customer = null;
  await assert.rejects(s.service().createPayment(dto), status(404));
  assert.equal(s.calls.posts.length, 0);
});
for (const [field, value] of [
  ['currency', 'USD'],
  ['outstandingAmount', 1.5],
  ['outstandingAmount', 2147483648],
]) {
  test(`documento inválido ${field}=${value} se rechaza antes de reservar`, async () => {
    const s = setup();
    s.state().documents[0][field] = value;
    await assert.rejects(s.service().createPayment(dto), status(400));
    assert.equal(s.state().payments.length, 0);
    assert.equal(s.calls.posts.length, 0);
  });
}
test('monto esperado distinto no crea reserva', async () => {
  const s = setup();
  await assert.rejects(
    s.service().createPayment(dto, { expectedAmount: 999 }),
    status(400),
  );
  assert.equal(s.state().payments.length, 0);
  assert.equal(s.calls.posts.length, 0);
});
test('fallo reservando revierte pago y documentos antes del POST', async () => {
  const s = setup();
  s.flags.reservationFailure = true;
  await assert.rejects(s.service().createPayment(dto), /reservation failed/);
  assert.equal(s.state().payments.length, 0);
  assert.equal(s.calls.posts.length, 0);
});
test('estado cambiado mientras responde Khipu no se sobrescribe con PENDING', async () => {
  const s = setup();
  s.flags.onPost = () => {
    s.state().payments[0].status = 'PAID';
  };
  await assert.rejects(s.service().createPayment(dto), status(503));
  assert.equal(s.state().payments[0].status, 'PAID');
  assert.equal(s.calls.posts.length, 1);
});
test('selecciones sin facturas compartidas pueden tener cobros distintos', async () => {
  const s = setup();
  s.state().documents.push({ ...s.state().documents[0], id: 'doc2' });
  for (const id of ['doc1', 'doc2'])
    await s
      .service()
      .createPayment({ ...dto, mode: 'MANUAL_SELECTION', documentIds: [id] });
  assert.equal(s.calls.posts.length, 2);
  assert.notEqual(
    s.state().payments[0].idempotencyKey,
    s.state().payments[1].idempotencyKey,
  );
});
test('proveedor desconocido se rechaza antes de reservar', async () => {
  const s = setup();
  s.config.KHIPU_PROVIDER = 'typo';
  await assert.rejects(s.service().createPayment(dto), status(503));
  assert.equal(s.calls.locks, 0);
});
test('selección manual de documentos ajenos no genera un cobro', async () => {
  const s = setup();
  await assert.rejects(
    s.service().createPayment({
      ...dto,
      mode: 'MANUAL_SELECTION',
      documentIds: ['foreign'],
    }),
    status(400),
  );
  assert.equal(s.calls.posts.length, 0);
});
test('Khipu real recibe señal de tiempo límite y solo un POST simulado', async () => {
  let count = 0;
  globalThis.fetch = async (_url, options) => {
    count++;
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    return {
      ok: true,
      json: async () => ({
        payment_id: 'real-test',
        payment_url: 'https://checkout.example.test',
      }),
    };
  };
  try {
    const config = {
      KHIPU_PROVIDER: 'real',
      KHIPU_BASE_URL: 'https://example.test',
      KHIPU_API_KEY: 'fake-test-key',
    };
    const service = new KhipuService({ get: (key) => config[key] });
    await service.createPayment({
      localPaymentId: 'test',
      amount: 1000,
      currency: 'CLP',
      subject: 'Test',
      returnUrl: 'https://example.test',
      cancelUrl: 'https://example.test',
      notifyUrl: '',
    });
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = () => {
      throw new Error('Red real prohibida');
    };
  }
});
