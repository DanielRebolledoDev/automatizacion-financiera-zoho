import { useQuery } from "@tanstack/react-query";
import { paymentExpressApi } from "../../../api/paymentExpress.api";

export function usePaymentExpressResult(paymentId: string | undefined) {
  return useQuery({
    queryKey: ["payment-express-result", paymentId],
    queryFn: () => {
      if (!paymentId) {
        throw new Error("ID de pago no disponible.");
      }

      return paymentExpressApi.getPaymentResult(paymentId);
    },
    enabled: Boolean(paymentId),
  });
}
