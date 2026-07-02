export interface PaymentExpressSummaryRequest {
  rut: string;
}

export interface PaymentExpressSummaryResponse {
  message: string;
  totalDebt: number;
  currency: string;
  canPay: boolean;
}
