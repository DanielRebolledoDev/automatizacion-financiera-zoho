import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZohoAuthService } from './zoho-auth.service';

type ZohoQueryParams = Record<string, string | number | boolean | undefined>;

@Injectable()
export class ZohoBooksService {
  constructor(
    private readonly configService: ConfigService,
    private readonly zohoAuthService: ZohoAuthService,
  ) {}

  async getFromBooks<TResponse>(
    path: string,
    queryParams: ZohoQueryParams = {},
  ): Promise<TResponse> {
    const accessToken = await this.zohoAuthService.getAccessToken();

    const booksBaseUrl = this.getRequiredConfig('ZOHO_BOOKS_BASE_URL').replace(
      /\/$/,
      '',
    );

    const organizationId = this.getRequiredConfig('ZOHO_ORGANIZATION_ID');

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${booksBaseUrl}${normalizedPath}`);

    url.searchParams.set('organization_id', organizationId);

    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const data = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Zoho Books no respondió correctamente.',
      );
    }

    return data as TResponse;
  }

  getConfigurationStatus() {
    return {
      clientIdConfigured: this.hasConfig('ZOHO_CLIENT_ID'),
      clientSecretConfigured: this.hasConfig('ZOHO_CLIENT_SECRET'),
      refreshTokenConfigured: this.hasConfig('ZOHO_REFRESH_TOKEN'),
      organizationIdConfigured: this.hasConfig('ZOHO_ORGANIZATION_ID'),
      booksBaseUrlConfigured: this.hasConfig('ZOHO_BOOKS_BASE_URL'),
    };
  }

  private hasConfig(key: string): boolean {
    return Boolean(this.configService.get<string>(key)?.trim());
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
