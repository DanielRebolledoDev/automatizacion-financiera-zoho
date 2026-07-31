export interface MatchedZohoInvoice {
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  contactNumber: string | null;
  status: string | null;
  date: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  currency: string;
}

export interface ZohoDebtByRutResult {
  normalizedRut: string;
  totalDebt: number;
  currency: string;
  canPay: boolean;
  invoiceCount: number;
  matchedInvoices: MatchedZohoInvoice[];
  scannedInvoices: number;
  scannedContacts: number;
}
