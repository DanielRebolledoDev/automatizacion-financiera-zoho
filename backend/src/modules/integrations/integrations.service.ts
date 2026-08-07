import { isValidRut, normalizeRut } from '../../common/utils/rut.util';
import { ZohoDebtByRutTestDto } from './dto/zoho-debt-by-rut-test.dto';
import {
  ForbiddenException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZohoAuthService } from '../zoho/zoho-auth.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { ZohoCustomerPaymentsService } from '../zoho/zoho-customer-payments.service';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly zohoAuthService: ZohoAuthService,
    private readonly zohoBooksService: ZohoBooksService,
    private readonly zohoCustomerPaymentsService: ZohoCustomerPaymentsService,
  ) {}

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
        accountsBaseUrl: this.getSafeValue('ZOHO_ACCOUNTS_BASE_URL'),
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

  async testZohoAuth() {
    this.assertDevelopmentOnly();

    await this.zohoAuthService.getAccessToken();

    return {
      message: 'Autenticación con Zoho realizada correctamente.',
      accessTokenObtained: true,
      tokenExposed: false,
    };
  }

  async listZohoOrganizations() {
    this.assertDevelopmentOnly();

    const organizations = await this.zohoBooksService.listOrganizations();

    return {
      message: 'Organizaciones de Zoho obtenidas correctamente.',
      data: organizations,
    };
  }

  async getConfiguredZohoOrganization() {
    this.assertDevelopmentOnly();

    const organization =
      await this.zohoBooksService.getConfiguredOrganization();

    return {
      message: 'Organización configurada obtenida correctamente.',
      data: organization,
    };
  }

  async listZohoUnpaidInvoicesTest() {
    this.assertDevelopmentOnly();

    const invoices = await this.zohoBooksService.listUnpaidInvoicesTest();

    return {
      message: 'Facturas impagas de Zoho obtenidas correctamente.',
      data: invoices,
    };
  }

  async listZohoUnpaidInvoicesDebug() {
    this.assertDevelopmentOnly();

    const invoices = await this.zohoBooksService.listUnpaidInvoicesForDebug({
      perPage: 10,
    });

    return {
      message: 'Resumen debug de facturas impagas obtenido correctamente.',
      data: invoices,
    };
  }

  async findZohoDebtByRutTest(dto: ZohoDebtByRutTestDto) {
    this.assertDevelopmentOnly();

    const normalizedRut = normalizeRut(dto.rut);

    if (!isValidRut(normalizedRut)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }

    const result =
      await this.zohoBooksService.findUnpaidInvoiceDebtByRut(normalizedRut);

    return {
      message: 'Deuda Zoho por RUT obtenida correctamente.',
      data: result,
    };
  }

  async findZohoContactFirstDebtByRutTest(dto: ZohoDebtByRutTestDto) {
    this.assertDevelopmentOnly();

    const normalizedRut = normalizeRut(dto.rut);

    if (!isValidRut(normalizedRut)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }

    const result =
      await this.zohoBooksService.findDebtByRutUsingContactFirst(normalizedRut);

    return {
      message:
        'Deuda Zoho por RUT obtenida correctamente usando contacto primero.',
      data: result,
    };
  }

  async buildZohoCustomerPaymentDryRun(paymentId: string) {
    this.assertDevelopmentOnly();

    const result =
      await this.zohoCustomerPaymentsService.buildCustomerPaymentDryRun(
        paymentId,
      );

    return {
      message: 'Dry-run de customer payment Zoho generado correctamente.',
      data: result,
    };
  }

  private assertDevelopmentOnly() {
    const nodeEnv = this.configService.get<string>('NODE_ENV');

    if (nodeEnv === 'production') {
      throw new ForbiddenException(
        'Este endpoint solo está disponible en ambiente de desarrollo.',
      );
    }
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
