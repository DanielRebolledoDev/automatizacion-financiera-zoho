import { createHmac, timingSafeEqual } from 'crypto';

// Política local de frescura; no es un plazo exigido por Khipu.
export const KHIPU_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export function verifyKhipuSignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  now = Date.now(),
): boolean {
  const fields = header.split(',').map((field) => field.trim());
  if (fields.length !== 2) return false;

  const timestamps = fields.filter((field) => field.startsWith('t='));
  const signatures = fields.filter((field) => field.startsWith('s='));
  if (timestamps.length !== 1 || signatures.length !== 1) return false;

  // slice conserva los signos '=' que forman parte del valor Base64.
  const timestampText = timestamps[0].slice(2);
  const signatureText = signatures[0].slice(2);
  if (!/^\d{13}$/.test(timestampText)) return false;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signatureText)) return false;

  const timestamp = Number(timestampText);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > KHIPU_SIGNATURE_TOLERANCE_MS
  ) {
    return false;
  }

  const received = Buffer.from(signatureText, 'base64');
  if (received.toString('base64') !== signatureText) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestampText}.`, 'utf8')
    .update(rawBody)
    .digest();

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
