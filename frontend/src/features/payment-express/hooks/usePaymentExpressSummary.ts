import { useMutation } from "@tanstack/react-query";
import { paymentExpressApi } from "../../../api/paymentExpress.api";
import type { PaymentExpressSummaryRequest } from "../types/paymentExpress.types";

export function usePaymentExpressSummary() {
  return useMutation({
    mutationFn: (body: PaymentExpressSummaryRequest) =>
      paymentExpressApi.getSummary(body),
  });
}
