const { createHash } = require('node:crypto');
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
const include = {
  documents: { include: { document: true }, orderBy: { documentId: 'asc' } },
};
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function stop(code) {
  throw new Error(code);
}
function checkId(id) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id ?? '',
    )
  )
    stop('INVALID_ID');
}
async function load(tx, id) {
  const root = await tx.payment.findUnique({ where: { id }, include });
  if (!root) stop('NOT_FOUND');
  const ids = root.documents.map((d) => d.documentId);
  if (!ids.length) stop('NO_DOCUMENTS');
  const rows = await tx.payment.findMany({
    where: {
      OR: [{ id }, { documents: { some: { documentId: { in: ids } } } }],
    },
    include,
    orderBy: { id: 'asc' },
    take: 101,
  });
  if (rows.length > 100) stop('TOO_MANY_RELATED_PAYMENTS');
  if (!rows.some((p) => p.id === id)) stop('INCONSISTENT_GROUP');
  return rows;
}
function validate(rows) {
  if (!rows.length) stop('EMPTY_GROUP');
  const first = rows[0];
  const docIds = first.documents.map((d) => d.documentId);
  if (!docIds.length || new Set(docIds).size !== docIds.length)
    stop('INVALID_DOCUMENTS');
  for (const p of rows) {
    if (
      p.customerId !== first.customerId ||
      p.currency !== 'CLP' ||
      !Number.isSafeInteger(p.amount) ||
      p.amount <= 0 ||
      p.amount !== first.amount
    )
      stop('GROUP_MISMATCH');
    if (
      ![
        'CREATED',
        'PENDING',
        'IN_PROGRESS',
        'CANCELLED',
        'EXPIRED',
        'FAILED',
      ].includes(p.status) ||
      p.confirmationReviewRequired !== true ||
      p.paidAt !== null
    )
      stop('GROUP_NOT_IN_REVIEW');
    if (
      !['OVERLAPPING_PAYMENT', 'DOCUMENT_BALANCE_CHANGED'].includes(
        p.confirmationReviewReason,
      )
    )
      stop('REASON_REQUIRES_MANUAL_REVIEW');
    if (!p.khipuPaymentId || /^(mock_|test_)/.test(p.khipuPaymentId))
      stop('TEST_OR_MISSING_PROVIDER_ID');
    if (
      p.zohoSyncStatus !== 'NOT_SYNCED' ||
      evidenceKeys.some((key) => p[key] !== null)
    )
      stop('ZOHO_EVIDENCE_PRESENT');
    if (
      JSON.stringify(p.documents.map((d) => d.documentId)) !==
      JSON.stringify(docIds)
    )
      stop('DIFFERENT_DOCUMENT_SETS');
    if (
      p.documents.reduce((sum, d) => sum + d.amount, 0) !== p.amount ||
      p.documents.some(
        (d) =>
          !Number.isSafeInteger(d.amount) ||
          d.amount <= 0 ||
          d.document.customerId !== p.customerId ||
          d.document.currency !== p.currency ||
          d.document.outstandingAmount !== d.amount ||
          !['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(d.document.status),
      )
    )
      stop('BALANCE_MISMATCH');
  }
  if (new Set(rows.map((p) => p.khipuPaymentId)).size !== rows.length)
    stop('DUPLICATE_PROVIDER_ID');
}
function stateKey(rows) {
  return hash(
    rows.map((p) => ({
      id: p.id,
      customerId: p.customerId,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      mode: p.mode,
      paidAt: p.paidAt,
      updatedAt: p.updatedAt,
      khipuPaymentId: p.khipuPaymentId,
      confirmationReviewRequired: p.confirmationReviewRequired,
      confirmationReviewReason: p.confirmationReviewReason,
      zohoSyncStatus: p.zohoSyncStatus,
      evidence: evidenceKeys.map((key) => p[key]),
      documents: p.documents.map((d) => ({
        id: d.documentId,
        amount: d.amount,
        customerId: d.document.customerId,
        currency: d.document.currency,
        balance: d.document.outstandingAmount,
        status: d.document.status,
        updatedAt: d.document.updatedAt,
      })),
    })),
  );
}
async function prepare(db, khipu, id) {
  checkId(id);
  const rows = await db.$transaction((tx) => load(tx, id), {
    isolationLevel: 'RepeatableRead',
  });
  validate(rows);
  const evidence = [];
  const checkedAt = Date.now();
  for (const p of rows) {
    const { response: r } = await khipu.getPaymentById(p.khipuPaymentId);
    if (
      !r ||
      r.payment_id !== p.khipuPaymentId ||
      r.transaction_id !== p.id ||
      r.currency !== p.currency ||
      !['number', 'string'].includes(typeof r.amount) ||
      !/^\d+(?:\.0+)?$/.test(String(r.amount)) ||
      Number(r.amount) !== p.amount
    )
      stop('REMOTE_IDENTITY_MISMATCH');
    if (!['done', 'deleted'].includes(r.status)) stop('REMOTE_NOT_FINAL');
    if (Date.now() - checkedAt > 30000) stop('EVIDENCE_TOO_OLD');
    evidence.push({ id: p.id, providerId: p.khipuPaymentId, status: r.status });
  }
  const winners = evidence.filter((e) => e.status === 'done');
  if (winners.length !== 1)
    stop(
      winners.length ? 'MULTIPLE_CONFIRMED_PAYMENTS' : 'NO_CONFIRMED_PAYMENT',
    );
  const state = stateKey(rows);
  return {
    rows,
    evidence,
    state,
    planHash: hash({ state, evidence }),
    winnerId: winners[0].id,
    checkedAt,
  };
}
function publicPlan(p) {
  return {
    mode: 'PREVIEW',
    mutationPerformed: false,
    remoteWriteAttempted: false,
    planHash: p.planHash,
    paidPaymentId: p.winnerId,
    cancelledPaymentIds: p.rows
      .filter((r) => r.id !== p.winnerId)
      .map((r) => r.id),
    amountAppliedOnce: p.rows[0].amount,
    currency: 'CLP',
    documentsAffected: p.rows[0].documents.length,
    zohoSyncWillRun: false,
    note: 'Solo aplicar tras verificar entorno DemoBank/produccion y autorizacion del responsable. El plan no elimina conflictos financieros.',
  };
}
async function apply(db, khipu, input) {
  checkId(input.id);
  if (
    input.confirm !== input.id ||
    !/^[a-f0-9]{64}$/.test(input.planHash ?? '') ||
    !/^[A-Za-z0-9_.@-]{3,80}$/.test(input.operator ?? '') ||
    !/^[A-Za-z0-9_.-]{3,80}$/.test(input.ticket ?? '')
  )
    stop('EXPLICIT_APPROVAL_REQUIRED');
  // Revalidar de nuevo con Khipu: nunca aplicar solo el plan anterior.
  const plan = await prepare(db, khipu, input.id);
  if (plan.planHash !== input.planHash) stop('PLAN_CHANGED');
  return db.$transaction(
    async (tx) => {
      const customerId = plan.rows[0].customerId;
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
      for (const p of plan.rows)
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${p.id} FOR UPDATE`;
      for (const d of plan.rows[0].documents)
        await tx.$queryRaw`SELECT id FROM customer_documents WHERE id = ${d.documentId} FOR UPDATE`;
      const rows = await load(tx, input.id);
      validate(rows);
      if (stateKey(rows) !== plan.state) stop('LOCAL_STATE_CHANGED');
      if (Date.now() - plan.checkedAt > 30000) stop('EVIDENCE_TOO_OLD');
      const ids = rows.map((p) => p.id);
      const priorPaid = await tx.paymentEvent.findFirst({
        where: {
          paymentId: { in: ids },
          eventType: { in: ['payment.paid.real', 'payment.paid.mock'] },
        },
        select: { id: true },
      });
      if (priorPaid) stop('PREVIOUS_PAID_EVENT');
      const now = new Date();
      const winner = rows.find((p) => p.id === plan.winnerId);
      for (const d of winner.documents) {
        const changed = await tx.customerDocument.updateMany({
          where: {
            id: d.documentId,
            customerId,
            currency: 'CLP',
            outstandingAmount: d.amount,
            updatedAt: d.document.updatedAt,
            status: d.document.status,
          },
          data: { outstandingAmount: 0, status: 'PAID' },
        });
        if (changed.count !== 1) stop('BALANCE_CHANGED');
      }
      for (const p of rows) {
        const paid = p.id === winner.id;
        const changed = await tx.payment.updateMany({
          where: {
            id: p.id,
            updatedAt: p.updatedAt,
            status: p.status,
            confirmationReviewRequired: true,
            zohoSyncStatus: 'NOT_SYNCED',
          },
          data: {
            status: paid ? 'PAID' : 'CANCELLED',
            ...(paid ? { paidAt: now } : {}),
            confirmationReviewRequired: false,
            confirmationReviewReason: null,
          },
        });
        if (changed.count !== 1) stop('PAYMENT_CHANGED');
        await tx.paymentEvent.create({
          data: {
            paymentId: p.id,
            eventSource: 'SYSTEM',
            eventType: 'payment.review.resolved',
            externalEventId: `review-resolved-${plan.planHash.slice(0, 32)}-${p.id}`,
            payload: {
              action: 'single-confirmed-payment',
              operator: input.operator,
              ticket: input.ticket,
              planHash: plan.planHash,
              previousStatus: p.status,
              previousReason: p.confirmationReviewReason,
              paidPaymentId: winner.id,
              providerStatus: paid ? 'done' : 'deleted',
              relatedPaymentIds: ids,
              noRemoteWrite: true,
            },
            processed: true,
            processedAt: now,
          },
        });
        await tx.paymentAttempt.create({
          data: {
            paymentId: p.id,
            customerId,
            mode: p.mode,
            amount: p.amount,
            status: paid ? 'PAID' : 'CANCELLED',
            requestPayload: {
              action: 'review-resolution',
              ticket: input.ticket,
            },
            responsePayload: { providerStatus: paid ? 'done' : 'deleted' },
          },
        });
      }
      await tx.paymentEvent.create({
        data: {
          paymentId: winner.id,
          eventSource: 'KHIPU',
          eventType: 'payment.paid.real',
          externalEventId: `khipu-paid-${winner.khipuPaymentId}`,
          payload: {
            resolvedReview: true,
            planHash: plan.planHash,
            operator: input.operator,
            ticket: input.ticket,
          },
          processed: true,
          processedAt: now,
        },
      });
      // Se preservan los eventos de revision originales: la resolucion es un evento nuevo.
      return {
        outcome: 'RESOLVED_LOCALLY',
        paidPaymentId: winner.id,
        cancelledPaymentIds: ids.filter((id) => id !== winner.id),
        zohoSyncStatus: 'NOT_SYNCED',
        remoteWriteAttempted: false,
      };
    },
    { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
  );
}
module.exports = { prepare, apply, publicPlan, validate, stateKey };
