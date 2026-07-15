export interface PaymentExpressDebtSummary {
  customerId: string;
  totalDebt: number;
  currency: string;
  canPay: boolean;
}

export interface CustomerReference {
  customerId: string;
}

export interface CustomerDataProvider {
  getPaymentExpressSummaryByRut(
    normalizedRut: string,
  ): Promise<PaymentExpressDebtSummary | null>;

  getCustomerReferenceByRut(
    normalizedRut: string,
  ): Promise<CustomerReference | null>;
}
