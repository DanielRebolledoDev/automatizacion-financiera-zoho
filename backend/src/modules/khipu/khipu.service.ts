import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

interface CreateKhipuMockPaymentParams {
  paymentId: string;
  amount: number;
  currency: string;
  subject: string;
  customerRut: string;
}

interface KhipuMockPaymentResponse {
  provider: 'MOCK_KHIPU';
  paymentId: string;
  paymentUrl: string;
  expiresAt: string;
  raw: {
    localPaymentId: string;
    amount: number;
    currency: string;
    subject: string;
    customerRut: string;
  };
}

@Injectable()
export class KhipuService {
  constructor(private readonly configService: ConfigService) {}

  createPayment(
    params: CreateKhipuMockPaymentParams,
  ): Promise<KhipuMockPaymentResponse> {
    const publicBackendUrl = this.getPublicBackendUrl();

    const mockPaymentId = `mock_${createHash('sha256')
      .update(params.paymentId)
      .digest('hex')
      .slice(0, 24)}`;

    return Promise.resolve({
      provider: 'MOCK_KHIPU',
      paymentId: mockPaymentId,
      paymentUrl: `${publicBackendUrl}/api/mock/khipu/checkout/${params.paymentId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      raw: {
        localPaymentId: params.paymentId,
        amount: params.amount,
        currency: params.currency,
        subject: params.subject,
        customerRut: params.customerRut,
      },
    });
  }

  private getPublicBackendUrl(): string {
    const publicBackendUrl = this.configService
      .get<string>('PUBLIC_BACKEND_URL')
      ?.trim();

    if (!publicBackendUrl) {
      return 'http://localhost:3000';
    }

    return publicBackendUrl.replace(/\/$/, '');
  }
}
