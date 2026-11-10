const { classify } = require('./payment-recovery-policy.cjs');
const evidenceKeys = [
  'zohoCustomerPaymentId',
  'zohoSyncRemotePaymentId',
  'zohoSyncAttemptId',
  'zohoSyncStartedAt',
  'zohoSyncOrganizationId',
  'zohoSyncedAt',
  'zohoSyncPayload',
  'zohoSyncError',
];
const select = Object.fromEntries(
  [
    'id',
    'status',
    'amount',
    'currency',
    'khipuPaymentId',
    'confirmationReviewRequired',
    'confirmationReviewReason',
    'zohoSyncStatus',
    'updatedAt',
    ...evidenceKeys,
  ].map((key) => [key, true]),
);
function summary(p) {
  return {
    id: p.id,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    confirmationReviewRequired: p.confirmationReviewRequired,
    confirmationReviewReason: p.confirmationReviewReason,
    zohoSyncStatus: p.zohoSyncStatus,
    updatedAt: p.updatedAt,
    providerKind: !p.khipuPaymentId
      ? 'NO_ID'
      : p.khipuPaymentId.startsWith('mock_')
        ? 'MOCK'
        : p.khipuPaymentId.startsWith('test_')
          ? 'SYNTHETIC'
          : 'API_ENVIRONMENT_UNVERIFIED',
    evidencePresent: Object.fromEntries(
      evidenceKeys.map((key) => [key, p[key] !== null && p[key] !== undefined]),
    ),
    recoveryPlan: classify(p),
  };
}
async function inspect(db, id) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id ?? '',
    )
  ) {
    throw new Error('INVALID_PAYMENT_ID');
  }
  return db.$transaction(
    async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id },
        select: {
          ...select,
          documents: {
            select: {
              documentId: true,
              amount: true,
              document: {
                select: {
                  status: true,
                  outstandingAmount: true,
                  currency: true,
                },
              },
            },
          },
        },
      });
      if (!payment) return { mode: 'READ_ONLY', found: false, id };
      const ids = payment.documents.map((d) => d.documentId);
      const related = ids.length
        ? await tx.payment.findMany({
            where: {
              id: { not: id },
              documents: { some: { documentId: { in: ids } } },
            },
            select,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            take: 51,
          })
        : [];
      const events = await tx.paymentEvent.findMany({
        where: { paymentId: id },
        select: {
          eventType: true,
          processed: true,
          processedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 51,
      });
      const attempts = await tx.paymentAttempt.findMany({
        where: { paymentId: id },
        select: { status: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 51,
      });
      return {
        mode: 'READ_ONLY',
        found: true,
        externalApisCalled: false,
        mutationPerformed: false,
        snapshotOnly: true,
        payment: summary(payment),
        documents: payment.documents,
        relatedPayments: related.slice(0, 50).map(summary),
        events: events.slice(0, 50),
        attempts: attempts.slice(0, 50),
        truncated: {
          relatedPayments: related.length > 50,
          events: events.length > 50,
          attempts: attempts.length > 50,
        },
        note: 'El plan no autoriza acciones. Verificar entorno DemoBank/real y evidencia externa antes de actuar. No quitar bloqueos con SQL.',
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 15000 },
  );
}
module.exports = { inspect };
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--id')
      throw new Error('EXPECTED_ID_ARGUMENT');
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient();
    try {
      console.log(JSON.stringify(await inspect(db, args[1]), null, 2));
    } finally {
      await db.$disconnect();
    }
  })().catch((error) => {
    const code = ['INVALID_PAYMENT_ID', 'EXPECTED_ID_ARGUMENT'].includes(
      error.message,
    )
      ? error.message
      : 'REVIEW_DIAGNOSTIC_FAILED';
    console.error(JSON.stringify({ outcome: 'STOPPED', code }));
    process.exitCode = 1;
  });
}
