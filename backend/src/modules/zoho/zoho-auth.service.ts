import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CachedZohoToken {
  accessToken: string;
  expiresAtMs: number;
}

interface ZohoTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  api_domain?: string;
  error?: string;
  error_description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isZohoTokenResponse(value: unknown): value is ZohoTokenResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.access_token === 'string' || typeof value.error === 'string'
  );
}

@Injectable()
export class ZohoAuthService {
  private cachedToken: CachedZohoToken | null = null;

  constructor(private readonly configService: ConfigService) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs > Date.now()) {
      return this.cachedToken.accessToken;
    }

    const clientId = this.getRequiredConfig('ZOHO_CLIENT_ID');
    const clientSecret = this.getRequiredConfig('ZOHO_CLIENT_SECRET');
    const refreshToken = this.getRequiredConfig('ZOHO_REFRESH_TOKEN');

    const accountsBaseUrl = this.getConfig(
      'ZOHO_ACCOUNTS_BASE_URL',
      'https://accounts.zoho.com',
    );

    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });

    const response = await fetch(`${accountsBaseUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = (await response.json().catch(() => null)) as unknown;

    if (!response.ok || !isZohoTokenResponse(data) || !data.access_token) {
      throw new ServiceUnavailableException(
        'No se pudo obtener access token desde Zoho.',
      );
    }

    const expiresInSeconds = data.expires_in ?? 3600;

    this.cachedToken = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + Math.max(expiresInSeconds - 60, 60) * 1000,
    };

    return data.access_token;
  }

  clearCachedToken() {
    this.cachedToken = null;
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

  private getConfig(key: string, fallback: string): string {
    return this.configService.get<string>(key)?.trim() || fallback;
  }
}
