const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { prepare, apply } = require('../scripts/payment-review-resolution.cjs');
async function main() {
  assert.ok(['development', 'test'].includes(process.env.NODE_ENV));
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.protocol, 'mysql:');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  for (const key of [
    'ZOHO_WRITE_PAYMENTS_ENABLED',
    'ZOHO_AUTO_SYNC_PAYMENTS_ENABLED',
  ])
    assert.equal(process.env[key]?.trim(), 'false', `${key} debe ser false`);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  const customers = [];
  const payments = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('HTTP_PROHIBIDO');
  };
  async function fixture() {
    const body = String(randomInt(90000000, 99999999));
    let sum = 0;
    let multiplier = 2;
    for (const c of [...body].reverse()) {
      sum += Number(c) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    const rest = 11 - (sum % 11);
    const rut = `${body}-${rest === 11 ? '0' : rest === 10 ? 'K' : rest}`;
    const customer = await db.customer.create({
      data: {
        rut,
        rutNormalized: rut,
        businessName: `PRUEBA RESOLUCION ${randomUUID()}`,
        documents: {
          create: {
            documentNumber: 'TEST-RESOLUTION',
            dueDate: new Date(),
            totalAmount: 1000,
            outstandingAmount: 1000,
            currency: 'CLP',
            status: 'OVERDUE',
          },
        },
      },
      include: { documents: true },
    });
    customers.push(customer.id);
    const doc = customer.documents[0];
    const rows = [];
    for (const status of ['EXPIRED', 'PENDING']) {
      const p = await db.payment.create({
        data: {
          customerId: customer.id,
          mode: 'TOTAL_DEBT',
          amount: 1000,
          currency: 'CLP',
          status,
          confirmationReviewRequired: true,
          confirmationReviewReason: 'OVERLAPPING_PAYMENT',
          idempotencyKey: randomUUID(),
          khipuPaymentId: `fixture_resolution_${randomUUID()}`,
          documents: { create: { documentId: doc.id, amount: 1000 } },
        },
      });
      rows.push(p);
      payments.push(p.id);
    }
    const statuses = ['done', 'deleted'];
    const khipu = {
      getPaymentById: async (providerId) => {
        const index = rows.findIndex((p) => p.khipuPaymentId === providerId);
        assert.ok(index >= 0);
        return {
          response: {
            payment_id: providerId,
            transaction_id: rows[index].id,
            amount: '1000.00',
            currency: 'CLP',
            status: statuses[index],
          },
        };
      },
    };
    const plan = await prepare(db, khipu, rows[0].id);
    const input = {
      id: rows[0].id,
      confirm: rows[0].id,
      planHash: plan.planHash,
      operator: 'local-test',
      ticket: 'TEST-RESOLUTION',
    };
    return { rows, doc, statuses, khipu, input };
  }
  try {
    const f = await fixture();
    const results = await Promise.allSettled([
      apply(db, f.khipu, f.input),
      apply(db, f.khipu, f.input),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      (await db.customerDocument.findUniqueOrThrow({ where: { id: f.doc.id } }))
        .outstandingAmount,
      0,
    );
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: f.rows[0].id } }))
        .status,
      'PAID',
    );
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: f.rows[1].id } }))
        .status,
      'CANCELLED',
    );
    assert.equal(
      await db.paymentEvent.count({
        where: { paymentId: f.rows[0].id, eventType: 'payment.paid.real' },
      }),
      1,
    );
    assert.equal(
      await db.paymentEvent.count({
        where: {
          paymentId: { in: f.rows.map((p) => p.id) },
          eventType: 'payment.review.resolved',
        },
      }),
      2,
    );
    await assert.rejects(apply(db, f.khipu, f.input));
    console.log(
      'OK: concurrencia y repeticion no duplican saldo ni confirmacion.',
    );
    const conflict = await fixture();
    conflict.statuses[1] = 'done';
    await assert.rejects(
      apply(db, conflict.khipu, conflict.input),
      /MULTIPLE_CONFIRMED_PAYMENTS/,
    );
    assert.equal(
      (
        await db.customerDocument.findUniqueOrThrow({
          where: { id: conflict.doc.id },
        })
      ).outstandingAmount,
      1000,
    );
    console.log('OK: dos confirmados conservan saldo y bloqueo.');
    const rollback = await fixture();
    const broken = {
      $transaction: (fn, options) =>
        db.$transaction((tx) => {
          const wrapped = new Proxy(tx, {
            get(target, key) {
              if (key === 'paymentEvent')
                return new Proxy(target.paymentEvent, {
                  get(delegate, method) {
                    if (method === 'create')
                      return async () => {
                        throw new Error('EVENT_FAILURE');
                      };
                    return delegate[method];
                  },
                });
              return target[key];
            },
          });
          return fn(wrapped);
        }, options),
    };
    await assert.rejects(
      apply(broken, rollback.khipu, rollback.input),
      /EVENT_FAILURE/,
    );
    assert.equal(
      (
        await db.customerDocument.findUniqueOrThrow({
          where: { id: rollback.doc.id },
        })
      ).outstandingAmount,
      1000,
    );
    for (const p of rollback.rows)
      assert.equal(
        (await db.payment.findUniqueOrThrow({ where: { id: p.id } }))
          .confirmationReviewRequired,
        true,
      );
    assert.equal(
      await db.paymentEvent.count({
        where: { paymentId: { in: rollback.rows.map((p) => p.id) } },
      }),
      0,
    );
    console.log(
      'OK: fallo de auditoria revierte toda la transaccion en MySQL.',
    );
    console.log(
      'PRUEBA MYSQL CORRECTA. Sin llamadas externas; datos sinteticos propios.',
    );
  } finally {
    // Los identificadores temporales solo permiten probar el motor inyectando respuestas.
    // Se reclasifican como test_ para excluirlos de cualquier recuperacion posterior.
    for (const id of payments)
      await db.payment.update({
        where: { id },
        data: { khipuPaymentId: `test_resolution_${id}` },
      });
    console.log('Clientes sinteticos conservados:', customers.join(', '));
    globalThis.fetch = oldFetch;
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error('PRUEBA DETENIDA:', error.code || error.name);
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
});
