import type { PaymentExpressResultPayment } from "../../payment-express/types/paymentExpress.types";
import { formatCurrency } from "../../../shared/utils/formatCurrency";

export function formatPaymentDate(
  value: string | number | Date | null | undefined,
): string {
  if (value === null || value === undefined || value === "")
    return "Sin fecha disponible";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha disponible";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

// Resumen del registro local. No es una factura ni un comprobante bancario.
export function buildPaymentSummary(
  payment: PaymentExpressResultPayment,
  generatedAt = new Date(),
): string {
  if (payment.status !== "PAID") {
    throw new Error(
      "El resumen está disponible cuando el pago está confirmado.",
    );
  }
  return [
    "PORTAL PAGO EXPRESS",
    "Resumen del pago confirmado",
    "",
    `ID de pago: ${payment.id}`,
    "Estado registrado en el portal: Confirmado (PAID)",
    `Monto: ${formatCurrency(payment.amount, payment.currency)}`,
    `Moneda: ${payment.currency}`,
    `Confirmación registrada: ${formatPaymentDate(payment.paidAt)}`,
    `Resumen generado: ${formatPaymentDate(generatedAt)}`,
    "Fechas expresadas en hora de Chile (America/Santiago).",
    "",
    "Este resumen refleja el estado del pago registrado en el portal.",
    "No reemplaza el comprobante bancario ni un documento tributario.",
    "La confirmación del pago no certifica la actualización de la deuda en otros sistemas.",
    "Si necesitas ayuda, comparte el ID de pago con la empresa.",
  ].join("\n");
}
