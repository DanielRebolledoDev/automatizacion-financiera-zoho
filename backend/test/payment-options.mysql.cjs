// Datos nuevos y etiquetados; se conservan para revision. Sin APIs externas.
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

async function main() {
  assert.ok(
    ['development', 'test'].includes(process.env.NODE_ENV),
    'Solo entorno development/test.',
  );
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.protocol, 'mysql:');
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Solo MySQL local.',
  );
  for (const key of [
    'ZOHO_WRITE_PAYMENTS_ENABLED',
    'ZOHO_AUTO_SYNC_PAYMENTS_ENABLED',
  ]) {
    assert.equal(process.env[key]?.trim(), 'false', `${key} debe ser false.`);
  }
  const root = [
    resolve(__dirname, '../dist'),
    resolve(__dirname, '../dist/src'),
  ].find((p) => existsSync(resolve(p, 'common/utils/debt-due-date.util.js')));
  assert.ok(root, 'Primero compila el backend con el bloque de deuda vencida.');
  const { PrismaClient } = require('@prisma/client');
  const { PaymentsService } = require(
    resolve(root, 'modules/payments/payments.service.js'),
  );
  const { PaymentExpressService } = require(
    resolve(root, 'modules/payment-express/payment-express.service.js'),
  );
  const { LocalCustomerDataProvider } = require(
    resolve(
      root,
      'modules/customer-data/provider/local-customer-data.provider.js',
    ),
  );
  const { KhipuService } = require(
    resolve(root, 'modules/khipu/khipu.service.js'),
  );
  const { getChileTodayDate } = require(
    resolve(root, 'common/utils/debt-due-date.util.js'),
  );
  const { calculateRutDv } = require(resolve(root, 'common/utils/rut.util.js'));
  const prisma = new PrismaClient();
  const configValues = {
    NODE_ENV: 'test',
    KHIPU_PROVIDER: 'mock',
    CUSTOMER_DATA_SOURCE: 'local',
    ZOHO_WRITE_PAYMENTS_ENABLED: 'false',
    ZOHO_AUTO_SYNC_PAYMENTS_ENABLED: 'false',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    PUBLIC_BACKEND_URL: 'http://localhost:3000',
  };
  const config = { get: (key) => configValues[key] };
  let remoteCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    remoteCalls++;
    throw new Error('HTTP externo prohibido en esta prueba.');
  };
  const payments = new PaymentsService(
    prisma,
    new KhipuService(config),
    config,
    {
      syncCustomerPaymentToZoho: () => {
        remoteCalls++;
        throw new Error('Zoho prohibido en esta prueba.');
      },
    },
  );
  const express = new PaymentExpressService(
    new LocalCustomerDataProvider(prisma),
    payments,
  );
  const run = randomUUID();
  const today = getChileTodayDate();
  const date = (days) => new Date(today.getTime() + days * 86400000);
  const customerIds = [];
  let checks = 0;
  const ok = (message) => {
    checks++;
    console.log(`OK ${checks}: ${message}`);
  };
  async function fixture(label, futureOnly = false) {
    const body = String(randomInt(90000000, 99999999));
    const rut = `${body}-${calculateRutDv(body)}`;
    const documents = futureOnly
      ? [
          {
            documentNumber: 'PRUEBA-FUTURA',
            dueDate: date(7),
            totalAmount: 10000,
            outstandingAmount: 10000,
            status: 'PENDING',
          },
        ]
      : [
          {
            documentNumber: 'PRUEBA-VENCIDA',
            dueDate: date(-5),
            totalAmount: 10000,
            outstandingAmount: 10000,
            status: 'OVERDUE',
          },
          {
            documentNumber: 'PRUEBA-PARCIAL',
            dueDate: date(-2),
            totalAmount: 8000,
            outstandingAmount: 3000,
            status: 'PARTIALLY_PAID',
          },
          {
            documentNumber: 'PRUEBA-HOY',
            dueDate: date(0),
            totalAmount: 5000,
            outstandingAmount: 5000,
            status: 'PENDING',
          },
          {
            documentNumber: 'PRUEBA-FUTURA',
            dueDate: date(7),
            totalAmount: 12000,
            outstandingAmount: 12000,
            status: 'PENDING',
          },
        ];
    // create nunca sustituye un cliente existente: una colision de RUT falla.
    const customer = await prisma.customer.create({
      data: {
        rut,
        rutNormalized: rut,
        businessName: `PRUEBA BETA ${label} ${run}`,
        documents: {
          create: documents.map((d) => ({
            ...d,
            currency: 'CLP',
            documentType: 'INVOICE',
          })),
        },
      },
      include: { documents: true },
    });
    customerIds.push(customer.id);
    console.log(`Cliente sintetico ${label}: ${customer.id}; RUT ${rut}`);
    return customer;
  }
  const selected = async (id) =>
    prisma.paymentDocument.findMany({
      where: { paymentId: id },
      include: { document: true },
    });
  const result = async (id) => (await express.getPaymentResult(id)).payment;
  const rejectStatus = (code) => (error) => error.getStatus?.() === code;
  try {
    await prisma.$connect();
    const mixed = await fixture('MIXTA');
    const dto = { rut: mixed.rut };
    const summary = await express.getSummary(dto);
    assert.equal(summary.totalDebt, 30000);
    assert.equal(summary.overdueDebt, 13000);
    ok('Deuda mixta: total 30000, vencida 13000; parcial usa solo su saldo.');

    const total = await express.payTotal(dto);
    assert.equal(total.payment.amount, 30000);
    assert.equal((await selected(total.payment.id)).length, 4);
    assert.match(total.payment.paymentUrl, /mock-khipu/);
    ok('Total reserva las cuatro facturas y obtiene checkout Mock.');
    await assert.rejects(express.payOverdue(dto), rejectStatus(409));
    ok(
      'Un total activo bloquea otro cobro de vencidas sobre las mismas facturas.',
    );

    await payments.cancelKhipuPayment(total.payment.id);
    assert.equal((await result(total.payment.id)).status, 'CANCELLED');
    const eventsBefore = await prisma.paymentEvent.count({
      where: { paymentId: total.payment.id },
    });
    await payments.cancelKhipuPayment(total.payment.id);
    assert.equal(
      await prisma.paymentEvent.count({
        where: { paymentId: total.payment.id },
      }),
      eventsBefore,
    );
    assert.equal((await express.getSummary(dto)).totalDebt, 30000);
    ok(
      'Cancelar preserva los saldos y repetir cancelacion no duplica eventos.',
    );

    const overdue = await express.payOverdue(dto);
    assert.equal(overdue.payment.amount, 13000);
    const links = await selected(overdue.payment.id);
    assert.deepEqual(links.map((d) => d.document.documentNumber).sort(), [
      'PRUEBA-PARCIAL',
      'PRUEBA-VENCIDA',
    ]);
    assert.deepEqual(
      links.map((d) => d.amount).sort((a, b) => a - b),
      [3000, 10000],
    );
    const same = await express.payOverdue(dto);
    assert.equal(same.payment.id, overdue.payment.id);
    assert.equal(same.reused, true);
    ok(
      'Solo vencidas selecciona dos documentos y reutiliza el cobro al repetir.',
    );

    await payments.markPaymentAsPaidFromMock(overdue.payment.id);
    assert.equal((await result(overdue.payment.id)).status, 'PAID');
    const after = await express.getSummary(dto);
    assert.equal(after.totalDebt, 17000);
    assert.equal(after.overdueDebt, 0);
    const untouched = await prisma.customerDocument.findMany({
      where: {
        customerId: mixed.id,
        documentNumber: { in: ['PRUEBA-HOY', 'PRUEBA-FUTURA'] },
      },
    });
    assert.equal(
      untouched.reduce((sum, d) => sum + d.outstandingAmount, 0),
      17000,
    );
    ok('Confirmar vencidas deja intactos los 17000 que vencen hoy o despues.');
    const paidEvents = await prisma.paymentEvent.count({
      where: { paymentId: overdue.payment.id },
    });
    await payments.markPaymentAsPaidFromMock(overdue.payment.id);
    assert.equal(
      await prisma.paymentEvent.count({
        where: { paymentId: overdue.payment.id },
      }),
      paidEvents,
    );
    ok('Repetir confirmacion no vuelve a aplicar el pago ni crea otro evento.');

    const all = await fixture('TOTAL');
    const full = await express.payTotal({ rut: all.rut });
    await payments.markPaymentAsPaidFromMock(full.payment.id);
    assert.equal((await result(full.payment.id)).status, 'PAID');
    assert.equal((await express.getSummary({ rut: all.rut })).totalDebt, 0);
    ok('Confirmar total salda todas las facturas del cliente de prueba.');

    const future = await fixture('SIN-VENCIDAS', true);
    await assert.rejects(
      express.payOverdue({ rut: future.rut }),
      rejectStatus(400),
    );
    assert.equal(
      await prisma.payment.count({ where: { customerId: future.id } }),
      0,
    );
    ok('Sin vencidas: rechazo antes de crear un pago.');
    assert.equal(remoteCalls, 0);
    const rows = await prisma.payment.findMany({
      where: { customerId: { in: customerIds } },
      select: {
        id: true,
        status: true,
        zohoSyncStatus: true,
        zohoCustomerPaymentId: true,
        zohoSyncRemotePaymentId: true,
      },
    });
    assert.ok(
      rows.every(
        (p) =>
          p.zohoSyncStatus === 'NOT_SYNCED' &&
          p.zohoCustomerPaymentId === null &&
          p.zohoSyncRemotePaymentId === null,
      ),
    );
    ok('Sin llamadas externas ni sincronizacion Zoho.');
    // Los intentos son historial; se informa su estado, sin corregirlo en el test.
    for (const row of rows) {
      const attempts = await prisma.paymentAttempt.findMany({
        where: { paymentId: row.id },
        select: { status: true },
        orderBy: { createdAt: 'asc' },
      });
      console.log(
        JSON.stringify({
          paymentId: row.id,
          status: row.status,
          attemptStatuses: attempts.map((a) => a.status),
        }),
      );
    }
    console.log(
      `PRUEBA CORRECTA: ${checks} comprobaciones. No cubre HTTP, navegador, webhook ni DemoBank.`,
    );
  } finally {
    console.log(
      `Ejecucion: ${run}. Clientes de prueba conservados: ${customerIds.join(', ') || 'ninguno'}.`,
    );
    globalThis.fetch = originalFetch;
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  // Evitar imprimir argumentos de Prisma, URL de conexion o stack con datos.
  console.error('PRUEBA DETENIDA:', error?.code || error?.name || 'Error');
  if (error instanceof assert.AssertionError) console.error(error.message);
  else if (error?.getStatus)
    console.error(`HTTP del servicio: ${error.getStatus()}; ${error.message}`);
  process.exitCode = 1;
});
