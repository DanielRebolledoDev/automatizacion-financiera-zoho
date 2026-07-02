import { useMutation } from "@tanstack/react-query";
import { paymentExpressApi } from "../../../api/paymentExpress.api";
import type { PaymentExpressPayTotalRequest } from "../types/paymentExpress.types";

export function usePaymentExpressPayTotal() {
  return useMutation({
    mutationFn: (body: PaymentExpressPayTotalRequest) =>
      paymentExpressApi.payTotal(body),
  });
}
