export interface ZohoCustomerPaymentInvoiceApplication {
  invoice_id: string;
  amount_applied: number;
}

export interface ZohoCreateCustomerPaymentPayload {
  customer_id: string;
  payment_mode: string;
  amount: number;
  date: string;
  reference_number: string;
  description: string;
  invoices: ZohoCustomerPaymentInvoiceApplication[];
}

export interface ZohoCustomerPaymentResponse {
  code?: number;
  message?: string;
  payment?: {
    payment_id?: string;
    payment_number?: string;
    customer_id?: string;
    customer_name?: string;
    amount?: number;
    payment_mode?: string;
    date?: string;
    reference_number?: string;
    status?: string;
    invoices?: Array<{
      invoice_id?: string;
      invoice_number?: string;
      amount_applied?: number;
      balance_amount?: number;
    }>;
  };
}

export interface ZohoCustomerPaymentDryRunResult {
  dryRun: true;
  sentToZoho: false;
  localPaymentId: string;
  payload: ZohoCreateCustomerPaymentPayload;
}

export interface ZohoCustomerPaymentSyncResult {
  dryRun: boolean;
  sentToZoho: boolean;
  localPaymentId: string;
  zohoCustomerPaymentId: string | null;
  payload: ZohoCreateCustomerPaymentPayload;
  zohoResponse?: ZohoCustomerPaymentResponse;
}
