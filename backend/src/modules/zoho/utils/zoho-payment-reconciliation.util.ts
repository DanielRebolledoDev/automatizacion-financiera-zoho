// Entradas externas y JSON persistido: se validan en ejecución, no mediante casts.
export function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveClp(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.0+)?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function invoiceMap(value: unknown): Map<string, number> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result = new Map<string, number>();
  for (const item of value) {
    const invoice = asObject(item);
    const id = invoice?.invoice_id;
    const amount = positiveClp(invoice?.amount_applied);
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      amount === null ||
      result.has(id)
    )
      return null;
    result.set(id, amount);
  }
  return result;
}

export function validateStoredZohoPayload(
  value: unknown,
  local: {
    id: string;
    amount: number;
    khipuPaymentId: string;
    currency: string;
  },
): Record<string, unknown> | null {
  const payload = asObject(value);
  const invoices = invoiceMap(payload?.invoices);
  if (
    !payload ||
    !invoices ||
    local.currency !== 'CLP' ||
    positiveClp(payload.amount) !== local.amount ||
    payload.reference_number !== local.khipuPaymentId ||
    typeof payload.customer_id !== 'string' ||
    !payload.customer_id.trim() ||
    typeof payload.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
    payload.description !==
      `Pago registrado desde Portal Pago Express. Pago local: ${local.id}` ||
    [...invoices.values()].reduce((sum, amount) => sum + amount, 0) !==
      local.amount
  )
    return null;
  return payload;
}

export function compareZohoPayment(
  stored: Record<string, unknown>,
  remoteValue: unknown,
  expectedRemoteId: string,
): string[] {
  const remote = asObject(remoteValue);
  if (!remote) return ['Respuesta sin objeto payment válido.'];
  const differences: string[] = [];
  if (remote.payment_id !== expectedRemoteId)
    differences.push('Identificador remoto distinto.');
  if (remote.customer_id !== stored.customer_id)
    differences.push('Cliente distinto.');
  if (remote.reference_number !== stored.reference_number)
    differences.push('Referencia distinta.');
  if (positiveClp(remote.amount) !== positiveClp(stored.amount))
    differences.push('Monto distinto o inválido.');
  if (remote.currency_code !== 'CLP')
    differences.push('Moneda distinta o ausente.');
  if (remote.date !== stored.date) differences.push('Fecha distinta.');
  if (remote.description !== stored.description)
    differences.push('Descripción de origen distinta.');
  if (remote.status !== 'success')
    differences.push('Estado remoto distinto de success.');
  // Exigir un valor explícito: no interpretar un campo ausente como devolución cero.
  if (
    (typeof remote.amount_refunded !== 'number' &&
      typeof remote.amount_refunded !== 'string') ||
    !/^0(?:\.0+)?$/.test(String(remote.amount_refunded))
  )
    differences.push('Devolución no nula o información de devolución ausente.');

  const expectedInvoices = invoiceMap(stored.invoices);
  const actualInvoices = invoiceMap(remote.invoices);
  if (
    !expectedInvoices ||
    !actualInvoices ||
    expectedInvoices.size !== actualInvoices.size ||
    [...expectedInvoices].some(
      ([id, amount]) => actualInvoices.get(id) !== amount,
    )
  )
    differences.push(
      'Facturas o montos aplicados distintos, duplicados o incompletos.',
    );
  return differences;
}
