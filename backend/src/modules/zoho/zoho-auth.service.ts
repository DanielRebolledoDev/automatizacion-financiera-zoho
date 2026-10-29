import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CachedZohoToken {
  accessToken: string;
  expiresAtMs: number;
}

@Injectable()
export class ZohoAuthService {
  private cachedToken: CachedZohoToken | null = null;
  private pendingToken: Promise<string> | null = null;
  private cacheGeneration = 0;

  constructor(private readonly configService: ConfigService) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs > Date.now()) {
      return this.cachedToken.accessToken;
    }
    if (this.pendingToken) return this.pendingToken;

    const pending = this.requestAccessToken(this.cacheGeneration);
    this.pendingToken = pending;
    try {
      return await pending;
    } finally {
      if (this.pendingToken === pending) this.pendingToken = null;
    }
  }

  private async requestAccessToken(generation: number): Promise<string> {
    const body = new URLSearchParams({
      refresh_token: this.getRequiredConfig('ZOHO_REFRESH_TOKEN'),
      client_id: this.getRequiredConfig('ZOHO_CLIENT_ID'),
      client_secret: this.getRequiredConfig('ZOHO_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    });
    const accountsBaseUrl = (
      this.configService.get<string>('ZOHO_ACCOUNTS_BASE_URL')?.trim() ||
      'https://accounts.zoho.com'
    ).replace(/\/$/, '');

    try {
      const response = await fetch(`${accountsBaseUrl}/oauth/v2/token`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data: unknown = await response.json();
      if (
        !response.ok ||
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
      ) {
        throw new Error('Respuesta OAuth inválida.');
      }
      const token = 'access_token' in data ? data.access_token : undefined;
      const expires = 'expires_in' in data ? data.expires_in : 3600;
      if (
        typeof token !== 'string' ||
        !token.trim() ||
        typeof expires !== 'number' ||
        !Number.isFinite(expires) ||
        expires <= 0 ||
        'error' in data
      ) {
        throw new Error('Respuesta OAuth inválida.');
      }
      if (generation === this.cacheGeneration) {
        this.cachedToken = {
          accessToken: token,
          // No extender artificialmente la vida de un token de duración corta.
          expiresAtMs: Date.now() + Math.max(expires - 60, 0) * 1000,
        };
      }
      return token;
    } catch {
      // No exponer tokens, secretos ni respuesta OAuth en el error público.
      throw new ServiceUnavailableException(
        'No se pudo obtener access token desde Zoho dentro del tiempo permitido o la respuesta fue inválida.',
      );
    }
  }

  clearCachedToken(): void {
    this.cachedToken = null;
    this.pendingToken = null;
    this.cacheGeneration += 1;
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
