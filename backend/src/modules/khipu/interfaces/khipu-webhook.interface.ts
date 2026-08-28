export interface KhipuWebhookPayload {
  payment_id?: string;
  receiver_id?: number;
  subject?: string;
  amount?: string | number;
  discount?: string | number;
  currency?: string;
  receipt_url?: string;
  bank?: string;
  bank_id?: string;
  payer_name?: string;
  payer_email?: string;
  personal_identifier?: string;
  bank_account_number?: string;
  out_of_date_conciliation?: boolean;
  transaction_id?: string;
  authorizer_operation_code?: string;
  responsible_user_email?: string;
  payment_method?: string;
  conciliation_date?: string;
  status?: string;
  [key: string]: unknown;
}
