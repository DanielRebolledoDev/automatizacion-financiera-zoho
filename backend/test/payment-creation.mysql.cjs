// Integración opt-in: escribe y elimina ÚNICAMENTE sus propios datos de prueba.
// Requiere MySQL local. Khipu y Zoho son dobles; nunca se invocan sus APIs.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const deferred = () => {
  let resolvePromise;
  const promise = new Promise((done) => {
    resolvePromise = done;
  });
  return { promise, resolve: resolvePromise };
};
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('La prueba concurrente superó 15 segundos.')),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test(
  'MySQL local: reserva persistente de cobros',
  {
    skip:
      process.env.PAYMENT_CREATION_DB_TEST !== '1'
        ? 'Activación explícita requerida.'
        : false,
  },
  async (t) => {
    assert.ok(
      ['development', 'test'].includes(process.env.NODE_ENV),
      'Solo development/test.',
    );
    const url = new URL(process.env.DATABASE_URL);
    assert.equal(url.protocol, 'mysql:', 'Requiere MySQL.');
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
      'Solo base local, nunca hosting.',
    );
    for (const key of [
      'ZOHO_WRITE_PAYMENTS_ENABLED',
      'ZOHO_AUTO_SYNC_PAYMENTS_ENABLED',
    ]) {
      assert.equal(
        process.env[key]?.trim(),
        'false',
        `${key} debe permanecer false.`,
      );
    }
    const root = [
      resolve(__dirname, '../dist'),
      resolve(__dirname, '../dist/src'),
    ].find((p) =>
      existsSync(resolve(p, 'modules/payments/payments.service.js')),
    );
    assert.ok(root, 'Ejecuta npm run build.');
    const { PrismaClient } = require('@prisma/client');
    const { PaymentsService } = require(
      resolve(root, 'modules/payments/payments.service.js'),
    );
    const clients = [new PrismaClient(), new PrismaClient()];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('HTTP prohibido en la prueba MySQL');
    };
    try {
      await Promise.all(clients.map((client) => client.$connect()));
      const engines = await clients[0].$queryRaw`
      SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('customers', 'payments', 'customer_documents', 'payment_documents', 'payment_attempts', 'payment_events')
    `;
      assert.equal(engines.length, 6);
      assert.ok(
        engines.every((row) => row.engine?.toLowerCase() === 'innodb'),
        'Las seis tablas deben usar InnoDB.',
      );

      async function fixture(run) {
        const id = randomUUID();
        const rut = `37C-${id.replaceAll('-', '').slice(0, 12)}`;
        await clients[0].customer.create({
          data: {
            id,
            rut,
            rutNormalized: rut,
            businessName: 'PRUEBA AUTOMATICA 37C',
          },
        });
        try {
          const document = await clients[0].customerDocument.create({
            data: {
              customerId: id,
              documentNumber: `TEST-${id}`,
              dueDate: new Date(),
              totalAmount: 1000,
              outstandingAmount: 1000,
              currency: 'CLP',
              status: 'PENDING',
            },
          });
          const config = {
            get: (key) =>
              ({
                KHIPU_PROVIDER: 'mock',
                CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
                PUBLIC_BACKEND_URL: 'http://localhost:3000',
              })[key],
          };
          const makeService = (client, createPayment) =>
            new PaymentsService(client, { createPayment }, config, {});
          const response = (params) => ({
            paymentId: `mock_${params.localPaymentId}`,
            paymentUrl: 'https://checkout.example.test',
            expiresAt: new Date(Date.now() + 3600000),
          });
          await run({
            id,
            document,
            dto: { customerId: id, mode: 'TOTAL_DEBT' },
            makeService,
            response,
          });
        } finally {
          await clients[0].$transaction(async (tx) => {
            const payments = await tx.payment.findMany({
              where: { customerId: id },
              select: { id: true },
            });
            const ids = payments.map((p) => p.id);
            await tx.paymentEvent.deleteMany({
              where: { paymentId: { in: ids } },
            });
            await tx.paymentAttempt.deleteMany({ where: { customerId: id } });
            await tx.paymentDocument.deleteMany({
              where: { paymentId: { in: ids } },
            });
            await tx.payment.deleteMany({ where: { customerId: id } });
            await tx.customerDocument.deleteMany({ where: { customerId: id } });
            await tx.customer.delete({ where: { id } });
          });
        }
      }

      await t.test(
        '20 solicitudes simultáneas, dos conexiones: solo un cobro y un intento',
        () =>
          fixture(async ({ id, dto, makeService, response }) => {
            const entered = deferred();
            const release = deferred();
            const nineteenDone = deferred();
            let posts = 0;
            let completed = 0;
            const fakePost = async (params) => {
              posts++;
              entered.resolve();
              await release.promise;
              return response(params);
            };
            const services = clients.map((client) =>
              makeService(client, fakePost),
            );
            const jobs = Array.from({ length: 20 }, (_, i) =>
              services[i % 2]
                .createPayment(dto)
                .then(
                  (value) => ({ ok: true, value }),
                  (error) => ({ ok: false, error }),
                )
                .then((result) => {
                  completed++;
                  if (completed === 19) nineteenDone.resolve();
                  return result;
                }),
            );
            const all = Promise.all(jobs);
            try {
              await bounded(entered.promise);
              await bounded(nineteenDone.promise);
              assert.equal(posts, 1);
              assert.equal(
                await clients[0].payment.count({ where: { customerId: id } }),
                1,
              );
              assert.equal(
                await clients[0].paymentAttempt.count({
                  where: { customerId: id },
                }),
                1,
              );
            } finally {
              release.resolve();
              await all;
            }
            const results = await all;
            assert.equal(results.filter((r) => r.ok).length, 1);
            assert.equal(
              results.filter((r) => !r.ok && r.error.getStatus?.() === 409)
                .length,
              19,
            );
            const reused = await services[1].createPayment(dto);
            assert.equal(reused.reused, true);
            assert.equal(posts, 1);
          }),
      );

      await t.test(
        'timeout simulado: otra conexión conserva la reserva y no reenvía',
        () =>
          fixture(async ({ id, dto, makeService }) => {
            let posts = 0;
            const failure = async () => {
              posts++;
              throw new Error('Timeout simulado');
            };
            await assert.rejects(
              makeService(clients[0], failure).createPayment(dto),
              (e) => e.getStatus?.() === 503,
            );
            await assert.rejects(
              makeService(clients[1], failure).createPayment(dto),
              (e) => e.getStatus?.() === 409,
            );
            assert.equal(posts, 1);
            const payments = await clients[1].payment.findMany({
              where: { customerId: id },
            });
            assert.equal(payments.length, 1);
            assert.equal(payments[0].status, 'CREATED');
            assert.equal(
              await clients[1].paymentEvent.count({
                where: {
                  paymentId: payments[0].id,
                  eventType: 'payment.creation.review_required',
                },
              }),
              1,
            );
          }),
      );

      await t.test(
        'pago confirmado con deuda local reabierta bloquea un segundo cobro',
        () =>
          fixture(async ({ dto, makeService, response }) => {
            let posts = 0;
            const service = makeService(clients[0], async (params) => {
              posts++;
              return response(params);
            });
            const result = await service.createPayment(dto);
            // Simula que Zoho todavía anuncia como impaga la factura ya confirmada.
            await clients[0].payment.update({
              where: { id: result.payment.id },
              data: { status: 'PAID', paidAt: new Date() },
            });
            await assert.rejects(
              service.createPayment(dto),
              (e) => e.getStatus?.() === 409,
            );
            assert.equal(posts, 1);
          }),
      );
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
      globalThis.fetch = originalFetch;
    }
  },
);
