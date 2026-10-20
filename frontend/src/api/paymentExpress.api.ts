import type {
  PaymentExpressPayTotalRequest,
  PaymentExpressPayTotalResponse,
  PaymentExpressResultResponse,
  PaymentExpressSummaryRequest,
  PaymentExpressSummaryResponse,
} from "../features/payment-express/types/paymentExpress.types";
import { httpClient } from "./httpClient";

export const paymentExpressApi = {
  getSummary: (body: PaymentExpressSummaryRequest) =>
    httpClient.post<
      PaymentExpressSummaryResponse,
      PaymentExpressSummaryRequest
    >("/payment-express/summary", body),

  payTotal: (body: PaymentExpressPayTotalRequest) =>
    httpClient.post<
      PaymentExpressPayTotalResponse,
      PaymentExpressPayTotalRequest
    >("/payment-express/pay-total", body),

  getPaymentResult: (paymentId: string) =>
    httpClient.get<PaymentExpressResultResponse>(
      `/payment-express/result/${encodeURIComponent(paymentId)}`,
    ),

  // Estos endpoints tienen otro formato de respuesta. Después de ejecutarlos
  // volvemos a obtener el resultado desde el endpoint de Pago Express.
  refreshPaymentStatus: (paymentId: string) =>
    httpClient.post<unknown, Record<string, never>>(
      `/payments/${encodeURIComponent(paymentId)}/refresh-khipu-status`,
      {},
    ),

  cancelPayment: (paymentId: string) =>
    httpClient.post<unknown, Record<string, never>>(
      `/payments/${encodeURIComponent(paymentId)}/cancel`,
      {},
    ),
};
