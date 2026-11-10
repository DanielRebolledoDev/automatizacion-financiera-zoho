const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { classify, recover } = require('./payment-recovery-policy.cjs');
async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--id', '--action', '--confirm']);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || opts[args[i]] !== undefined)
      throw new Error('INVALID_ARGUMENTS');
    opts[args[i]] = args[i + 1];
  }
  const id = opts['--id'];
  const action = opts['--action'] ?? 'plan';
  if (
    id &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new Error('INVALID_PAYMENT_ID');
  if (!['plan', 'check-khipu', 'send-zoho', 'reconcile-zoho'].includes(action))
    throw new Error('INVALID_ACTION');
  if (action !== 'plan' && (!id || opts['--confirm'] !== id))
    throw new Error('EXPLICIT_ID_CONFIRMATION_REQUIRED');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    await db.$connect();
    if (action === 'plan') {
      const records = id
        ? [await db.payment.findUnique({ where: { id } })].filter(Boolean)
        : await db.payment.findMany({
            where: {
              OR: [
                { confirmationReviewRequired: true },
                { zohoSyncStatus: { not: 'SYNCED' } },
              ],
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 51,
          });
      console.log(
        JSON.stringify(
          {
            mode: 'READ_ONLY',
            found: records.length > 0,
            truncated: records.length > 50,
            payments: records.slice(0, 50).map((p) => ({
              id: p.id,
              status: p.status,
              zohoSyncStatus: p.zohoSyncStatus,
              ...classify(p),
            })),
          },
          null,
          2,
        ),
      );
      return;
    }
    const root = [
      resolve(__dirname, '../dist'),
      resolve(__dirname, '../dist/src'),
    ].find((p) =>
      existsSync(resolve(p, 'modules/payments/payments.service.js')),
    );
    if (!root) throw new Error('BUILD_REQUIRED');
    const { ConfigService } = require('@nestjs/config');
    const { KhipuService } = require(
      resolve(root, 'modules/khipu/khipu.service.js'),
    );
    const { PaymentsService } = require(
      resolve(root, 'modules/payments/payments.service.js'),
    );
    const { ZohoAuthService } = require(
      resolve(root, 'modules/zoho/zoho-auth.service.js'),
    );
    const { ZohoBooksService } = require(
      resolve(root, 'modules/zoho/zoho-books.service.js'),
    );
    const { ZohoCustomerPaymentsService } = require(
      resolve(root, 'modules/zoho/zoho-customer-payments.service.js'),
    );
    const baseConfig = new ConfigService();
    // La recuperacion Khipu nunca inicia sincronizacion Zoho indirectamente.
    const paymentConfig = {
      get: (key) =>
        key === 'ZOHO_AUTO_SYNC_PAYMENTS_ENABLED'
          ? 'false'
          : baseConfig.get(key),
    };
    const auth = new ZohoAuthService(baseConfig);
    const books = new ZohoBooksService(baseConfig, auth);
    const zoho = new ZohoCustomerPaymentsService(db, baseConfig, books);
    const khipu = new KhipuService(baseConfig);
    const payments = new PaymentsService(db, khipu, paymentConfig, zoho);
    const result = await recover({
      id,
      action,
      confirmation: opts['--confirm'],
      env: process.env,
      readPayment: (paymentId) =>
        db.payment.findUnique({ where: { id: paymentId } }),
      khipu,
      payments,
      zoho,
    });
    const current = await db.payment.findUniqueOrThrow({ where: { id } });
    console.log(
      JSON.stringify(
        {
          id,
          ...result,
          currentStatus: current.status,
          confirmationReviewRequired: current.confirmationReviewRequired,
          zohoSyncStatus: current.zohoSyncStatus,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  // No imprimir payload de proveedor, stack ni credenciales de conexion.
  const safe =
    typeof error.message === 'string' &&
    /^[A-Z_]+(?::[A-Z_]+)?$/.test(error.message);
  console.error(
    JSON.stringify(
      {
        outcome: 'STOPPED',
        code: safe ? error.message : 'SERVICE_ERROR',
        httpStatus:
          typeof error.getStatus === 'function' ? error.getStatus() : undefined,
        note: 'No repitas un envio por este error. Ejecuta plan de nuevo y revisa el estado persistido.',
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
