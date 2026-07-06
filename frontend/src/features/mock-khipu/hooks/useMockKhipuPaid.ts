import { useMutation } from "@tanstack/react-query";
import { mockKhipuApi } from "../../../api/mockKhipu.api";

export function useMockKhipuPaid() {
  return useMutation({
    mutationFn: (paymentId: string) => mockKhipuApi.markAsPaid(paymentId),
  });
}
