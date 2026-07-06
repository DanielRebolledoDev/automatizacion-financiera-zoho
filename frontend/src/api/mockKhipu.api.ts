import { httpClient } from "./httpClient";

interface MockKhipuPaidResponse {
  message: string;
  alreadyProcessed: boolean;
  payment: {
    id: string;
    mode: string;
    amount: number;
    currency: string;
    status: string;
    khipuPaymentId: string | null;
    khipuPaymentUrl: string | null;
    paidAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  };
}

export const mockKhipuApi = {
  markAsPaid: (paymentId: string) =>
    httpClient.post<MockKhipuPaidResponse, Record<string, never>>(
      `/webhooks/khipu/mock-paid/${paymentId}`,
      {},
    ),
};
