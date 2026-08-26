export interface CreateKhipuPaymentParams {
  localPaymentId: string;
  amount: number;
  currency: string;
  subject: string;
  body?: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}

export interface KhipuPaymentResponse {
  paymentId: string;
  paymentUrl: string;
  simplifiedTransferUrl?: string;
  transferUrl?: string;
  appUrl?: string;
  readyForTerminal?: boolean;
  expiresAt?: Date | null;
  providerResponse?: unknown;
}

export interface KhipuCreatePaymentApiResponse {
  payment_id?: string;
  payment_url?: string;
  simplified_transfer_url?: string;
  transfer_url?: string;
  app_url?: string;
  ready_for_terminal?: boolean;
}
