export function cleanRut(rut: string): string {
  return rut
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/\s/g, '')
    .toUpperCase();
}

export function normalizeRut(rut: string): string {
  const cleanedRut = cleanRut(rut);

  if (cleanedRut.length < 2) {
    return cleanedRut;
  }

  const body = cleanedRut.slice(0, -1);
  const dv = cleanedRut.slice(-1);

  return `${body}-${dv}`;
}

export function calculateRutDv(body: string): string {
  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);

  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';

  return String(remainder);
}

export function isValidRut(rut: string): boolean {
  const cleanedRut = cleanRut(rut);

  if (!/^\d{7,8}[0-9K]$/.test(cleanedRut)) {
    return false;
  }

  const body = cleanedRut.slice(0, -1);
  const dv = cleanedRut.slice(-1);

  return calculateRutDv(body) === dv;
}
