const active = new Set(['CREATED', 'PENDING', 'IN_PROGRESS']);
const terminal = new Set(['CANCELLED', 'EXPIRED', 'FAILED']);
function classify(payment) {
  if (!payment) return { outcome: 'NOT_FOUND', actions: [] };
  if (payment.confirmationReviewRequired !== false)
    return { outcome: 'CONFIRMATION_REVIEW', actions: [] };
  if (!payment.khipuPaymentId)
    return { outcome: 'CREATION_UNCERTAIN', actions: [] };
  if (payment.khipuPaymentId.startsWith('mock_'))
    return { outcome: 'MOCK', actions: [] };
  if (payment.khipuPaymentId.startsWith('test_'))
    return { outcome: 'SYNTHETIC_TEST', actions: [] };
  if (active.has(payment.status))
    return { outcome: 'CHECK_KHIPU', actions: ['check-khipu'] };
  if (terminal.has(payment.status))
    return { outcome: 'CHECK_TERMINAL_KHIPU', actions: ['check-khipu'] };
  if (payment.status !== 'PAID')
    return { outcome: 'UNKNOWN_STATE', actions: [] };
  if (payment.zohoSyncStatus === 'SYNCED')
    return { outcome: 'ALREADY_SYNCED', actions: [] };
  if (payment.zohoSyncStatus === 'SENDING')
    return { outcome: 'SENDING_REQUIRES_INSPECTION', actions: [] };
  if (payment.zohoSyncStatus === 'FAILED')
    return { outcome: 'LEGACY_REQUIRES_INSPECTION', actions: [] };
  if (payment.zohoSyncStatus === 'REVIEW_REQUIRED') {
    return { outcome: 'UNCERTAIN_ZOHO_ATTEMPT', actions: ['reconcile-zoho'] };
  }
  const noEvidence = [
    'zohoCustomerPaymentId',
    'zohoSyncRemotePaymentId',
    'zohoSyncAttemptId',
    'zohoSyncStartedAt',
    'zohoSyncOrganizationId',
    'zohoSyncedAt',
    'zohoSyncPayload',
    'zohoSyncError',
  ].every((key) => payment[key] === null);
  if (
    ['NOT_SYNCED', 'DRY_RUN_READY'].includes(payment.zohoSyncStatus) &&
    noEvidence
  ) {
    return { outcome: 'PAID_WITHOUT_ZOHO_ATTEMPT', actions: ['send-zoho'] };
  }
  return { outcome: 'INCONSISTENT_SYNC_STATE', actions: [] };
}
async function recover({
  id,
  action,
  confirmation,
  env,
  readPayment,
  khipu,
  payments,
  zoho,
}) {
  if (confirmation !== id) throw new Error('CONFIRMATION_REQUIRED');
  // Releer siempre al ejecutar: el diagnostico previo no autoriza un estado antiguo.
  const payment = await readPayment(id);
  const plan = classify(payment);
  if (!plan.actions.includes(action))
    throw new Error(`ACTION_BLOCKED:${plan.outcome}`);
  if (action === 'send-zoho') {
    if (env.ZOHO_WRITE_PAYMENTS_ENABLED?.trim() !== 'true')
      throw new Error('ZOHO_WRITE_DISABLED');
    const result = await zoho.syncCustomerPaymentToZoho(id);
    return {
      outcome: 'ZOHO_SEND_RESULT',
      sentToZoho: result.sentToZoho === true,
    };
  }
  if (action === 'reconcile-zoho') {
    const result = await zoho.reconcileCustomerPayment(id);
    return {
      outcome: result.outcome,
      reconciled: result.reconciled === true,
      resendAllowed: false,
    };
  }
  const { response } = await khipu.getPaymentById(payment.khipuPaymentId);
  if (
    response.payment_id !== payment.khipuPaymentId ||
    response.transaction_id !== id ||
    response.currency !== payment.currency ||
    !Number.isSafeInteger(Number(response.amount)) ||
    Number(response.amount) <= 0 ||
    Number(response.amount) !== payment.amount
  )
    throw new Error('KHIPU_DETAILS_MISMATCH');
  if (response.status === 'done') {
    const result = await payments.markPaymentAsPaidFromKhipuWebhook({
      localPaymentId: id,
      khipuPaymentId: payment.khipuPaymentId,
      amount: Number(response.amount),
      currency: response.currency,
      payload: response,
    });
    return {
      outcome: 'KHIPU_CONFIRMATION_RESULT',
      status: result.payment.status,
      alreadyProcessed: result.alreadyProcessed,
    };
  }
  if (response.status === 'deleted') {
    // Estado observado en GET de un cobro cancelado. Solo informar: nunca
    // convertirlo a PAID, liberar reservas o deducir un nuevo estado local.
    return {
      outcome: 'KHIPU_DELETED',
      khipuStatus: 'deleted',
      localStatus: payment.status,
      localStateChanged: false,
      requiresInspection: payment.status !== 'CANCELLED',
    };
  }
  if (!['pending', 'verifying'].includes(response.status))
    throw new Error('KHIPU_UNKNOWN_STATUS');
  // No liberar reservas, reabrir terminales ni crear nuevos cobros.
  return {
    outcome: 'KHIPU_NOT_DONE',
    khipuStatus: response.status,
    localStatus: payment.status,
  };
}
module.exports = { classify, recover };
