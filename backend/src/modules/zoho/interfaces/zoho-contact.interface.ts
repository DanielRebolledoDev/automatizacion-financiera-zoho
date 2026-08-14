export interface ZohoContact {
  contact_id?: string;
  contact_name?: string;
  company_name?: string;
  contact_number?: string;
  contact_type?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  [key: string]: unknown;
}

export interface ZohoContactResponse {
  code?: number;
  message?: string;
  contact?: ZohoContact;
}
