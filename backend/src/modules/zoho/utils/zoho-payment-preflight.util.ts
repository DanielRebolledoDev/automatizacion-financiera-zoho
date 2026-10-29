import { asObject } from './zoho-payment-reconciliation.util';

function clpAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.0+)?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function validateInvoiceForPayment(
  response: unknown,
  expected: { invoiceId: string; customerId: string; amount: number },
): string[] {
  const body = asObject(response);
  const invoice = asObject(body?.invoice);
  if (body?.code !== 0 || !invoice)
    return ['Respuesta sin detalle válido de factura.'];

  const differences: string[] = [];
  if (invoice.invoice_id !== expected.invoiceId)
    differences.push('Factura distinta.');
  if (invoice.customer_id !== expected.customerId)
    differences.push('Cliente distinto.');
  if (invoice.currency_code !== 'CLP')
    differences.push('Moneda distinta de CLP o ausente.');
  // Política del piloto: otros estados requieren revisión, no autorización implícita.
  if (!['sent', 'overdue', 'partially_paid'].includes(String(invoice.status))) {
    differences.push('Estado de factura no habilitado para este flujo.');
  }
  const balance = clpAmount(invoice.balance);
  const total = clpAmount(invoice.total);
  if (!Number.isSafeInteger(expected.amount) || expected.amount <= 0) {
    differences.push('Monto solicitado inválido.');
  }
  if (balance === null || balance < expected.amount) {
    differences.push('Saldo remoto inválido o insuficiente.');
  }
  if (
    total === null ||
    total <= 0 ||
    expected.amount > total ||
    (balance !== null && balance > total)
  ) {
    differences.push('Total remoto inválido o inconsistente con el saldo.');
  }
  return differences;
}
