import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IntegrationsService {
  constructor(private readonly configService: ConfigService) {}

  getStatus() {
    return {
      message: 'Estado de integraciones obtenido correctamente.',
      zoho: {
        ready: this.areConfigured([
          'ZOHO_CLIENT_ID',
          'ZOHO_CLIENT_SECRET',
          'ZOHO_REFRESH_TOKEN',
          'ZOHO_ORGANIZATION_ID',
          'ZOHO_BOOKS_BASE_URL',
        ]),
        clientIdConfigured: this.hasConfig('ZOHO_CLIENT_ID'),
        clientSecretConfigured: this.hasConfig('ZOHO_CLIENT_SECRET'),
        refreshTokenConfigured: this.hasConfig('ZOHO_REFRESH_TOKEN'),
        organizationIdConfigured: this.hasConfig('ZOHO_ORGANIZATION_ID'),
        booksBaseUrl: this.getSafeValue('ZOHO_BOOKS_BASE_URL'),
      },
      khipu: {
        ready: this.areConfigured([
          'KHIPU_RECEIVER_ID',
          'KHIPU_SECRET_KEY',
          'KHIPU_BASE_URL',
        ]),
        receiverIdConfigured: this.hasConfig('KHIPU_RECEIVER_ID'),
        secretKeyConfigured: this.hasConfig('KHIPU_SECRET_KEY'),
        baseUrl: this.getSafeValue('KHIPU_BASE_URL'),
        webhookSecretConfigured: this.hasConfig('KHIPU_WEBHOOK_SECRET'),
      },
      app: {
        publicBackendUrlConfigured: this.hasConfig('PUBLIC_BACKEND_URL'),
        corsAllowedOrigins: this.getSafeValue('CORS_ALLOWED_ORIGINS'),
      },
    };
  }

  private areConfigured(keys: string[]): boolean {
    return keys.every((key) => this.hasConfig(key));
  }

  private hasConfig(key: string): boolean {
    return Boolean(this.configService.get<string>(key)?.trim());
  }

  private getSafeValue(key: string): string | null {
    return this.configService.get<string>(key)?.trim() || null;
  }
}
