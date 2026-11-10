const assert = require('node:assert/strict');
const { test: check } = require('node:test');
const { createHmac, randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { Module, ServiceUnavailableException } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const root = [
  resolve(__dirname, '../dist'),
  resolve(__dirname, '../dist/src'),
].find((p) => existsSync(resolve(p, 'modules/payments/payments.service.js')));
assert.ok(root, 'Ejecuta npm run build.');
const { KhipuWebhookController } = require(
  resolve(root, 'modules/webhooks/khipu-webhook/khipu-webhook.controller.js'),
);
const { PaymentsService } = require(
  resolve(root, 'modules/payments/payments.service.js'),
);
const { KhipuService } = require(
  resolve(root, 'modules/khipu/khipu.service.js'),
);
const secret = 'test-only-key-not-a-real-credential';
const id = randomUUID();
const remoteId = 'testkhipu001';
const payload = { transaction_id: id, payment_id: remoteId };
const sign = (raw, time = Date.now(), key = secret) =>
  `t=${time},s=${createHmac('sha256', key).update(`${time}.`).update(raw).digest('base64')}`;

check(
  'HTTP local: firma, cuerpo original, consulta autenticada y repeticion',
  async (t) => {
    let payment, confirmed, counts, failApi;
    function reset() {
      payment = {
        id,
        khipuPaymentId: remoteId,
        status: 'PENDING',
        amount: 1000,
        currency: 'CLP',
      };
      confirmed = {
        payment_id: remoteId,
        transaction_id: id,
        status: 'done',
        amount: '1000.0000',
        currency: 'CLP',
      };
      counts = { reads: 0, api: 0, confirmations: 0 };
      failApi = false;
    }
    reset();
    const fakePayments = {
      findPaymentStatusById: async () => {
        counts.reads++;
        return { payment: { ...payment } };
      },
      markPaymentAsPaidFromKhipuWebhook: async () => {
        const alreadyProcessed = payment.status === 'PAID';
        if (!alreadyProcessed) {
          counts.confirmations++;
          payment.status = 'PAID';
        }
        return { alreadyProcessed, payment: { status: payment.status } };
      },
    };
    class WebhookTestModule {}
    Module({
      controllers: [KhipuWebhookController],
      providers: [
        { provide: PaymentsService, useValue: fakePayments },
        {
          provide: KhipuService,
          useValue: {
            getPaymentById: async () => {
              counts.api++;
              if (failApi)
                throw new ServiceUnavailableException(
                  'API simulada no disponible',
                );
              return { response: confirmed };
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key) => (key === 'KHIPU_WEBHOOK_SECRET' ? secret : undefined),
          },
        },
      ],
    })(WebhookTestModule);
    const app = await NestFactory.create(WebhookTestModule, {
      rawBody: true,
      logger: false,
    });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/api/webhooks/khipu/real`;
    async function post(raw = JSON.stringify(payload), signature = sign(raw)) {
      const headers = { 'Content-Type': 'application/json' };
      if (signature !== null) headers['x-khipu-signature'] = signature;
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: raw,
        signal: AbortSignal.timeout(5000),
      });
      return { status: r.status, body: await r.json() };
    }
    try {
      await t.test(
        'sin firma: 401 antes de leer pago o consultar Khipu',
        async () => {
          reset();
          assert.equal((await post(undefined, null)).status, 401);
          assert.deepEqual(counts, { reads: 0, api: 0, confirmations: 0 });
        },
      );
      for (const [label, header] of [
        [
          'secreto incorrecto',
          sign(JSON.stringify(payload), Date.now(), 'incorrect'),
        ],
        ['firma antigua', sign(JSON.stringify(payload), Date.now() - 600000)],
        ['firma futura', sign(JSON.stringify(payload), Date.now() + 600000)],
        [
          'cabecera duplicada',
          `${sign(JSON.stringify(payload))},t=${Date.now()}`,
        ],
      ]) {
        await t.test(`${label}: 401 sin efectos`, async () => {
          reset();
          assert.equal((await post(undefined, header)).status, 401);
          assert.equal(counts.reads, 0);
          assert.equal(counts.confirmations, 0);
        });
      }
      await t.test('alterar espacios despues de firmar: 401', async () => {
        reset();
        const raw = JSON.stringify(payload);
        assert.equal(
          (await post(JSON.stringify(payload, null, 2), sign(raw))).status,
          401,
        );
        assert.equal(counts.api, 0);
      });
      await t.test(
        'JSON con espacios firmado tal cual: acepta rawBody',
        async () => {
          reset();
          const r = await post(JSON.stringify(payload, null, 2));
          assert.equal(r.status, 200);
          assert.equal(r.body.processed, true);
          assert.equal(counts.confirmations, 1);
        },
      );
      await t.test(
        'repeticion confirmada: no repite consulta API ni confirmacion',
        async () => {
          reset();
          await post();
          const r = await post();
          assert.equal(r.status, 200);
          assert.equal(r.body.alreadyProcessed, true);
          assert.equal(counts.api, 1);
          assert.equal(counts.confirmations, 1);
        },
      );
      await t.test('cobro ajeno: rechaza antes de consulta API', async () => {
        reset();
        payment.khipuPaymentId = 'different';
        assert.equal((await post()).status, 400);
        assert.equal(counts.api, 0);
      });
      for (const patch of [
        { amount: '1000.4' },
        { amount: '999' },
        { currency: 'USD' },
        { transaction_id: randomUUID() },
        { payment_id: 'different' },
      ]) {
        await t.test(
          `detalle incompatible ${JSON.stringify(patch)}: no confirma`,
          async () => {
            reset();
            Object.assign(confirmed, patch);
            assert.equal((await post()).status, 400);
            assert.equal(counts.confirmations, 0);
          },
        );
      }
      for (const state of ['pending', 'verifying']) {
        await t.test(`${state}: notificacion no confirma pago`, async () => {
          reset();
          confirmed.status = state;
          const r = await post();
          assert.equal(r.status, 200);
          assert.equal(r.body.processed, false);
          assert.equal(counts.confirmations, 0);
        });
      }
      await t.test(
        'fallo consultando API: 503 sin confirmar; nueva entrega puede procesar',
        async () => {
          reset();
          failApi = true;
          assert.equal((await post()).status, 503);
          assert.equal(counts.confirmations, 0);
          failApi = false;
          assert.equal((await post()).status, 200);
          assert.equal(counts.confirmations, 1);
        },
      );
    } finally {
      await app.close();
    }
  },
);

check(
  'consultas y cancelacion: monto decimal incompatible se rechaza sin cambios',
  async () => {
    const payment = {
      id,
      customerId: 'customer',
      khipuPaymentId: remoteId,
      status: 'PENDING',
      amount: 1000,
      currency: 'CLP',
      documents: [],
    };
    const service = new PaymentsService(
      { payment: { findUnique: async () => payment } },
      {
        getPaymentById: async () => ({
          response: {
            payment_id: remoteId,
            transaction_id: id,
            amount: '1000.4',
            currency: 'CLP',
            status: 'done',
          },
        }),
      },
      {},
      {},
    );
    await assert.rejects(
      service.refreshPaymentStatusFromKhipu(id),
      (e) => e.getStatus?.() === 400,
    );
    await assert.rejects(
      service.cancelKhipuPayment(id),
      (e) => e.getStatus?.() === 400,
    );
    await assert.rejects(
      service.markPaymentAsPaidFromKhipuWebhook({
        localPaymentId: id,
        khipuPaymentId: remoteId,
        amount: 1000.4,
        currency: 'CLP',
        payload: {},
      }),
      (e) => e.getStatus?.() === 400,
    );
  },
);

check(
  'consulta Khipu: signal de plazo y error de red convertido a 503',
  async () => {
    const originalFetch = globalThis.fetch;
    const values = {
      KHIPU_BASE_URL: 'https://example.invalid',
      KHIPU_API_KEY: 'fake-test-key',
    };
    const service = new KhipuService({ get: (key) => values[key] });
    try {
      globalThis.fetch = async (_, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        throw new Error('private-network-details');
      };
      await assert.rejects(
        service.getPaymentById(remoteId),
        (e) =>
          e.getStatus?.() === 503 &&
          !e.message.includes('private-network-details'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

check(
  'cancelacion agrega un intento final sin borrar el inicial ni duplicarlo',
  async () => {
    const payment = {
      id,
      customerId: 'customer',
      mode: 'TOTAL_DEBT',
      status: 'PENDING',
      khipuPaymentId: 'mock_test',
      amount: 1000,
      currency: 'CLP',
      documents: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null,
      expiresAt: null,
    };
    const attempts = [{ status: 'PENDING' }];
    const events = [];
    const tx = {
      payment: {
        updateMany: async () => {
          if (payment.status !== 'PENDING') return { count: 0 };
          payment.status = 'CANCELLED';
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({ ...payment }),
      },
      paymentAttempt: {
        create: async ({ data }) => {
          attempts.push(data);
          return data;
        },
      },
      paymentEvent: {
        create: async ({ data }) => {
          events.push(data);
          return data;
        },
      },
    };
    const prisma = {
      payment: { findUnique: async () => ({ ...payment }) },
      $transaction: async (fn) => fn(tx),
    };
    const service = new PaymentsService(prisma, {}, {}, {});
    await service.cancelKhipuPayment(id);
    await service.cancelKhipuPayment(id);
    assert.deepEqual(
      attempts.map((a) => a.status),
      ['PENDING', 'CANCELLED'],
    );
    assert.equal(events.length, 1);
  },
);
