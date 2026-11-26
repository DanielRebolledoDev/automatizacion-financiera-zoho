// Los identificadores de Zoho se conservan como texto: no usar Number/parseInt.
export function readZohoPaymentAccountId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^\d{1,100}$/.test(id) && !/^0+$/.test(id) ? id : null;
}
