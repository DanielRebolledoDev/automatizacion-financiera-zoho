const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  prepare,
  apply,
  publicPlan,
} = require('./payment-review-resolution.cjs');
async function main() {
  const args = process.argv.slice(2);
  const opts = {};
  const allowed = new Set([
    '--id',
    '--action',
    '--confirm',
    '--plan',
    '--operator',
    '--ticket',
  ]);
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || opts[args[i]])
      throw new Error('INVALID_ARGUMENTS');
    opts[args[i]] = args[i + 1];
  }
  const action = opts['--action'] ?? 'preview';
  if (!['preview', 'apply', 'inspect-sending'].includes(action))
    throw new Error('INVALID_ACTION');
  const id = opts['--id'];
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id ?? '',
    )
  )
    throw new Error('INVALID_ID');
  if (
    action !== 'preview' &&
    (opts['--confirm'] !== id ||
      !/^[A-Za-z0-9_.@-]{3,80}$/.test(opts['--operator'] ?? '') ||
      !/^[A-Za-z0-9_.-]{3,80}$/.test(opts['--ticket'] ?? ''))
  )
    throw new Error('EXPLICIT_APPROVAL_REQUIRED');
  const root = [
    resolve(__dirname, '../dist'),
    resolve(__dirname, '../dist/src'),
  ].find((p) => existsSync(resolve(p, 'modules/khipu/khipu.service.js')));
  if (!root) throw new Error('BUILD_REQUIRED');
  const { PrismaClient } = require('@prisma/client');
  const { ConfigService } = require('@nestjs/config');
  const db = new PrismaClient();
  const config = new ConfigService();
  try {
    if (action === 'inspect-sending') {
      const p = await db.payment.findUnique({ where: { id } });
      if (
        !p ||
        p.zohoSyncStatus !== 'SENDING' ||
        p.confirmationReviewRequired !== false ||
        !p.khipuPaymentId ||
        /^(mock_|test_|fixture_)/.test(p.khipuPaymentId)
      )
        throw new Error('SENDING_INSPECTION_BLOCKED');
      const { ZohoAuthService } = require(
        resolve(root, 'modules/zoho/zoho-auth.service.js'),
      );
      const { ZohoBooksService } = require(
        resolve(root, 'modules/zoho/zoho-books.service.js'),
      );
      const { ZohoCustomerPaymentsService } = require(
        resolve(root, 'modules/zoho/zoho-customer-payments.service.js'),
      );
      const books = new ZohoBooksService(config, new ZohoAuthService(config));
      const service = new ZohoCustomerPaymentsService(db, config, books);
      const result = await service.reconcileCustomerPayment(id, {
        operator: opts['--operator'],
        ticket: opts['--ticket'],
      });
      console.log(
        JSON.stringify(
          {
            outcome: result.outcome,
            reconciled: result.reconciled,
            resendAllowed: false,
            remoteWriteAttempted: false,
          },
          null,
          2,
        ),
      );
      return;
    }
    const { KhipuService } = require(
      resolve(root, 'modules/khipu/khipu.service.js'),
    );
    const provider = new KhipuService(config);
    const khipu = {
      getPaymentById: (providerId) => {
        if (/^fixture_/.test(providerId))
          throw new Error('SYNTHETIC_TEST_BLOCKED');
        return provider.getPaymentById(providerId);
      },
    };
    const result =
      action === 'preview'
        ? publicPlan(await prepare(db, khipu, id))
        : await apply(db, khipu, {
            id,
            confirm: opts['--confirm'],
            planHash: opts['--plan'],
            operator: opts['--operator'],
            ticket: opts['--ticket'],
          });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      outcome: 'STOPPED',
      code: /^[A-Z_]+$/.test(error.message ?? '')
        ? error.message
        : 'RESOLUTION_FAILED',
      note: 'Conservar bloqueo. Consultar diagnostico antes de repetir. No reenviar a proveedores.',
    }),
  );
  process.exitCode = 1;
});
