export interface PaymentExpressSummaryRequest {
  rut: string;
}

export interface PaymentExpressSummaryResponse {
  message: string;
  totalDebt: number;
  currency: string;
  canPay: boolean;
}

export interface PaymentExpressPayTotalRequest {
  rut: string;
}

export interface PaymentExpressPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paymentUrl: string | null;
  expiresAt: string | null;
}

export interface PaymentExpressPayTotalResponse {
  message: string;
  reused: boolean;
  payment: PaymentExpressPayment;
}
