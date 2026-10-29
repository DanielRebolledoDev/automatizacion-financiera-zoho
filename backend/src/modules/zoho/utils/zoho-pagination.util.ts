import { ServiceUnavailableException } from '@nestjs/common';
import { asObject } from './zoho-payment-reconciliation.util';

export function parseZohoListPage(
  value: unknown,
  collection: 'invoices' | 'contacts',
  requestedPage: number,
  seenIds: Set<string>,
): { items: Record<string, unknown>[]; hasMore: boolean } {
  const body = asObject(value);
  const rawItems = body?.[collection];
  const pagination = asObject(body?.page_context);
  if (
    body?.code !== 0 ||
    !Array.isArray(rawItems) ||
    typeof pagination?.has_more_page !== 'boolean' ||
    (pagination.page !== undefined && pagination.page !== requestedPage)
  ) {
    throw new ServiceUnavailableException(
      'Zoho devolvió un listado o una paginación inválidos. No se actualizará la deuda.',
    );
  }
  if (rawItems.length === 0 && pagination.has_more_page) {
    throw new ServiceUnavailableException(
      'Zoho devolvió una página vacía indicando más resultados. No se actualizará la deuda.',
    );
  }
  const idField = collection === 'invoices' ? 'invoice_id' : 'contact_id';
  const items = rawItems.map((value: unknown) => {
    const item = asObject(value);
    const id = item?.[idField];
    if (!item || typeof id !== 'string' || !id.trim() || seenIds.has(id)) {
      throw new ServiceUnavailableException(
        'Zoho devolvió registros inválidos o repetidos. No se actualizará la deuda.',
      );
    }
    seenIds.add(id);
    return item;
  });
  return { items, hasMore: pagination.has_more_page };
}
