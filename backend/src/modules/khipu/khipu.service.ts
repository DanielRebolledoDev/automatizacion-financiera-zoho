import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type {
  CreateKhipuPaymentParams,
  KhipuCreatePaymentApiResponse,
  KhipuPaymentResponse,
} from './interfaces/khipu-payment.interface';

@Injectable()
export class KhipuService {
  constructor(private readonly configService: ConfigService) {}

  async createPayment(
    params: CreateKhipuPaymentParams,
  ): Promise<KhipuPaymentResponse> {
    const provider =
      this.configService.get<string>('KHIPU_PROVIDER')?.trim() ?? 'mock';

    if (provider === 'real') {
      return this.createRealPayment(params);
    }

    return this.createMockPayment(params);
  }

  private createMockPayment(
    params: CreateKhipuPaymentParams,
  ): KhipuPaymentResponse {
    const mockPaymentId = createHash('sha256')
      .update(`${params.localPaymentId}-${Date.now()}`)
      .digest('hex')
      .slice(0, 12);

    const frontendUrl = this.getFrontendBaseUrl();

    return {
      paymentId: `mock_${mockPaymentId}`,
      paymentUrl: `${frontendUrl}/mock-khipu/checkout/${params.localPaymentId}`,
      simplifiedTransferUrl: `${frontendUrl}/mock-khipu/checkout/${params.localPaymentId}`,
      transferUrl: `${frontendUrl}/mock-khipu/checkout/${params.localPaymentId}`,
      appUrl: undefined,
      readyForTerminal: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      providerResponse: {
        provider: 'mock',
        localPaymentId: params.localPaymentId,
      },
    };
  }

  private async createRealPayment(
    params: CreateKhipuPaymentParams,
  ): Promise<KhipuPaymentResponse> {
    const baseUrl = this.getRequiredConfig('KHIPU_BASE_URL').replace(/\/$/, '');
    const notifyApiVersion =
      this.configService.get<string>('KHIPU_NOTIFY_API_VERSION')?.trim() ??
      '3.0';

    const requestBody: Record<string, unknown> = {
      amount: params.amount,
      currency: params.currency,
      subject: params.subject,
      body: params.body,
      transaction_id: params.localPaymentId,
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
    };

    if (this.shouldSendNotifyUrl(params.notifyUrl)) {
      requestBody.notify_url = params.notifyUrl;
      requestBody.notify_api_version = notifyApiVersion;
    }

    const response = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...this.getKhipuAuthHeaders(),
      },
      body: JSON.stringify(requestBody),
    });

    const data = (await response
      .json()
      .catch(() => null)) as KhipuCreatePaymentApiResponse | null;

    if (!response.ok) {
      throw new ServiceUnavailableException({
        message: 'Khipu no respondió correctamente al crear el cobro.',
        status: response.status,
        response: data,
      });
    }

    if (!data?.payment_id || !data.payment_url) {
      throw new ServiceUnavailableException({
        message: 'Khipu respondió sin payment_id o payment_url.',
        response: data,
      });
    }

    return {
      paymentId: data.payment_id,
      paymentUrl: data.payment_url,
      simplifiedTransferUrl: data.simplified_transfer_url,
      transferUrl: data.transfer_url,
      appUrl: data.app_url,
      readyForTerminal: data.ready_for_terminal,
      expiresAt: null,
      providerResponse: data,
    };
  }

  async getPaymentById(khipuPaymentId: string) {
    const baseUrl = this.getRequiredConfig('KHIPU_BASE_URL').replace(/\/$/, '');

    const response = await fetch(
      `${baseUrl}/payments/${encodeURIComponent(khipuPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...this.getKhipuAuthHeaders(),
        },
      },
    );

    const data = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new ServiceUnavailableException({
        message: 'Khipu no respondió correctamente al consultar el pago.',
        status: response.status,
        response: data,
      });
    }

    return {
      ok: true,
      paymentId: khipuPaymentId,
      response: data,
    };
  }

  private getFrontendBaseUrl(): string {
    const corsOrigins =
      this.configService.get<string>('CORS_ALLOWED_ORIGINS')?.trim() ?? '';

    const firstOrigin = corsOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)[0];

    return firstOrigin || 'http://localhost:5173';
  }

  private getKhipuAuthHeaders(): Record<string, string> {
    const authMode =
      this.configService.get<string>('KHIPU_AUTH_MODE')?.trim() ?? 'api_key';

    if (authMode === 'basic') {
      const receiverId = this.getRequiredConfig('KHIPU_RECEIVER_ID');
      const secretKey = this.getRequiredConfig('KHIPU_SECRET_KEY');

      const encodedCredentials = Buffer.from(
        `${receiverId}:${secretKey}`,
        'utf8',
      ).toString('base64');

      return {
        Authorization: `Basic ${encodedCredentials}`,
      };
    }

    const apiKey = this.getRequiredConfig('KHIPU_API_KEY');

    return {
      'x-api-key': apiKey,
    };
  }

  async testConnection() {
    const baseUrl = this.getRequiredConfig('KHIPU_BASE_URL').replace(/\/$/, '');

    const response = await fetch(`${baseUrl}/banks`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...this.getKhipuAuthHeaders(),
      },
    });

    const data = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new ServiceUnavailableException({
        message: 'Khipu no respondió correctamente al probar conexión.',
        status: response.status,
        response: data,
      });
    }

    return {
      ok: true,
      provider: this.configService.get<string>('KHIPU_PROVIDER') ?? 'mock',
      authMode: this.configService.get<string>('KHIPU_AUTH_MODE') ?? 'api_key',
      response: data,
    };
  }

  private shouldSendNotifyUrl(notifyUrl: string): boolean {
    if (!notifyUrl) {
      return false;
    }

    if (notifyUrl.includes('localhost')) {
      return false;
    }

    if (notifyUrl.includes('127.0.0.1')) {
      return false;
    }

    return notifyUrl.startsWith('https://');
  }
  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new ServiceUnavailableException(
        `Falta configurar la variable de entorno ${key}.`,
      );
    }

    return value;
  }
}
