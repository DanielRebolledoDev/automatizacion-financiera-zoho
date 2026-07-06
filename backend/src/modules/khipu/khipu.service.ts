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
    const frontendUrl = this.getFrontendUrl();

    const mockPaymentId = `mock_${createHash('sha256')
      .update(params.paymentId)
      .digest('hex')
      .slice(0, 24)}`;

    return Promise.resolve({
      provider: 'MOCK_KHIPU',
      paymentId: mockPaymentId,
      paymentUrl: `${frontendUrl}/mock-khipu/checkout/${params.paymentId}`,
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

  private getFrontendUrl(): string {
    const corsAllowedOrigins = this.configService
      .get<string>('CORS_ALLOWED_ORIGINS')
      ?.trim();

    if (!corsAllowedOrigins) {
      return 'http://localhost:5173';
    }

    const firstOrigin = corsAllowedOrigins.split(',')[0]?.trim();

    return firstOrigin || 'http://localhost:5173';
  }
}
