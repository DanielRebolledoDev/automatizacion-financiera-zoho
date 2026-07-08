export function cleanRutInput(value: string) {
  return value.replace(/[^0-9kK]/g, '').toUpperCase();
}

export function formatRutInput(value: string) {
  const cleaned = cleanRutInput(value);

  if (cleaned.length <= 1) {
    return cleaned;
  }

  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);

  const formattedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${formattedBody}-${dv}`;
}