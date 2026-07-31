export interface ZohoInvoice {
  invoice_id?: string;
  invoice_number?: string;
  customer_id?: string;
  customer_name?: string;
  status?: string;
  date?: string;
  due_date?: string;
  total?: number;
  balance?: number;
  currency_code?: string;
  custom_fields?: unknown[];
  [key: string]: unknown;
}

export interface ZohoInvoicesResponse {
  code?: number;
  message?: string;
  invoices?: ZohoInvoice[];
  page_context?: {
    page?: number;
    per_page?: number;
    has_more_page?: boolean;
    report_name?: string;
    applied_filter?: string;
    custom_fields?: unknown[];
    sort_column?: string;
    sort_order?: string;
  };
}
