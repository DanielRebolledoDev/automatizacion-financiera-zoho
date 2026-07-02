import type {
  PaymentExpressPayTotalRequest,
  PaymentExpressPayTotalResponse,
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
};
