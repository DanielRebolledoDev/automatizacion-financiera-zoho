import { jsPDF } from "jspdf";
import logoDataUrl from "../../../assets/receipts/logo-cls.png?inline";
import type { PaymentExpressResultPayment } from "../../payment-express/types/paymentExpress.types";
import { formatPaymentDate } from "./paymentResultSummary";

const NAVY = "#16354D";
const MUTED = "#526574";
const BLUE = "#0D8AC7";
const GREEN = "#A2CF32";
const RED = "#FA2342";

/** Documento del registro del portal; no consulta ni modifica pagos. */
export function buildPaymentReceiptPdf(
  payment: PaymentExpressResultPayment,
  generatedAt = new Date(),
): jsPDF {
  if (payment.status !== "PAID") {
    throw new Error(
      "El comprobante está disponible cuando el pago está confirmado.",
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      payment.id,
    ) ||
    !Number.isFinite(payment.amount) ||
    payment.amount <= 0 ||
    !/^[A-Z]{3}$/.test(payment.currency) ||
    Number.isNaN(generatedAt.getTime())
  ) {
    throw new Error("Los datos del pago no permiten generar el comprobante.");
  }

  const rawReference = payment.khipuPaymentId;
  const reference =
    typeof rawReference === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(rawReference)
      ? rawReference
      : "No disponible";
  const mockReference = reference.startsWith("mock_");

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `Comprobante de pago ${payment.id}`,
    subject: "Registro de pago confirmado en el Portal Pago Express",
    author: "Cunlogan - Portal Pago Express",
    creator: "Portal Pago Express",
  });
  doc.setCreationDate(generatedAt);
  doc.setLanguage("es-CL");

  const text = (
    value: string,
    x: number,
    y: number,
    size = 10,
    color = NAVY,
    bold = false,
  ) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color);
    doc.text(value, x, y);
  };
  const paragraph = (
    value: string,
    x: number,
    y: number,
    width: number,
    size = 9,
  ) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const lines: string[] = [];
    let line = "";
    for (const word of value.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && doc.getTextWidth(next) > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    lines.forEach((value, index) =>
      text(value, x, y + index * 4.6, size, MUTED),
    );
    return y + lines.length * 4.6;
  };

  [BLUE, GREEN, RED].forEach((color, index) => {
    doc.setFillColor(color);
    doc.rect(index * 70, 0, 70, 3, "F");
  });
  doc.addImage(logoDataUrl, "PNG", 20, 16, 36, (36 * 1280) / 1506);
  text("PAGO EXPRESS", 135, 26, 11, BLUE, true);
  text("Portal de pagos Cunlogan", 135, 33, 9, MUTED);
  doc.setDrawColor("#DCE5EB");
  doc.line(20, 57, 190, 57);
  text("Comprobante de pago", 20, 73, 25, NAVY, true);
  text("Registro de confirmación en el portal", 20, 82, 11, MUTED);

  doc.setFillColor("#EFF6FA");
  doc.roundedRect(20, 94, 170, 43, 3, 3, "F");
  text("MONTO CONFIRMADO", 27, 105, 9, MUTED, true);
  const amount = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: payment.currency,
  })
    .format(payment.amount)
    .replace(/\u00a0|\u202f/g, " ");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(29);
  const amountFont = Math.min(
    29,
    (29 * 108) / Math.max(1, doc.getTextWidth(amount)),
  );
  text(amount, 27, 124, amountFont, NAVY, true);
  text(payment.currency, 159, 123, 11, MUTED, true);

  doc.setFillColor("#E8F3ED");
  doc.roundedRect(20, 145, 170, 13, 2, 2, "F");
  text("PAGO CONFIRMADO", 26, 153.5, 10, "#226349", true);

  text("ID DE PAGO EN EL PORTAL", 20, 173, 8, MUTED, true);
  text(payment.id, 20, 181, 10, NAVY, true);
  doc.setDrawColor("#DCE5EB");
  text(
    mockReference ? "REFERENCIA SIMULADA (MOCK)" : "REFERENCIA DE PAGO KHIPU",
    20,
    191,
    8,
    MUTED,
    true,
  );
  // Divide referencias largas sin perder caracteres ni invadir otros campos.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const referenceLines: string[] = [];
  let referenceLine = "";
  for (const character of reference) {
    if (doc.getTextWidth(referenceLine + character) > 165) {
      referenceLines.push(referenceLine);
      referenceLine = character;
    } else {
      referenceLine += character;
    }
  }
  if (referenceLine) referenceLines.push(referenceLine);
  referenceLines.forEach((line, index) =>
    text(line, 20, 198 + index * 4, 9, NAVY, true),
  );
  doc.line(20, 207, 190, 207);
  text("CONFIRMACIÓN REGISTRADA", 20, 217, 8, MUTED, true);
  text(formatPaymentDate(payment.paidAt), 20, 225, 10);
  text("DOCUMENTO GENERADO", 112, 217, 8, MUTED, true);
  text(formatPaymentDate(generatedAt), 112, 225, 10);
  text(
    "Fechas expresadas en hora de Chile (America/Santiago).",
    20,
    233,
    8,
    MUTED,
  );

  text("Conserva este comprobante", 20, 246, 12, NAVY, true);
  paragraph(
    "Si necesitas ayuda, comparte el ID de pago con la empresa para identificar tu operación.",
    20,
    253,
    165,
    10,
  );
  doc.line(20, 264, 190, 264);
  paragraph(
    "Este documento refleja el pago confirmado en el portal. No reemplaza el comprobante bancario ni un documento tributario, y no acredita por sí solo la actualización de la deuda en otros sistemas.",
    20,
    272,
    170,
    8,
  );
  text("Cunlogan  /  Pago Express", 20, 289, 8, MUTED);
  text("1 / 1", 181, 289, 8, MUTED);
  return doc;
}

export function createPaymentReceiptBlob(
  payment: PaymentExpressResultPayment,
): Blob {
  return buildPaymentReceiptPdf(payment).output("blob");
}
