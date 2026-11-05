// Las fechas de factura son fechas civiles (YYYY-MM-DD), no instantes de pago.
export function getChileTodayDate(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value;
  return new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`,
  );
}

export function isDebtOverdue(
  dueDate: string | Date | null,
  today: Date,
): boolean {
  if (!dueDate) return false;
  const date =
    dueDate instanceof Date ? dueDate : new Date(`${dueDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return false;
  if (
    typeof dueDate === 'string' &&
    date.toISOString().slice(0, 10) !== dueDate
  )
    return false;
  return date.getTime() < today.getTime();
}
