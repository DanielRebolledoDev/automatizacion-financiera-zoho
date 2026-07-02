import { httpClient } from "./httpClient";
import type {
  PaymentExpressSummaryRequest,
  PaymentExpressSummaryResponse,
} from "../features/payment-express/types/paymentExpress.types";

export const paymentExpressApi = {
  getSummary: (body: PaymentExpressSummaryRequest) =>
    httpClient.post<
      PaymentExpressSummaryResponse,
      PaymentExpressSummaryRequest
    >("/payment-express/summary", body),
};
