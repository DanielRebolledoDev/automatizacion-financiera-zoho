import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

interface IntegrationRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class IntegrationsAdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const environment = this.configService.get<string>('NODE_ENV')?.trim();
    // Estas son herramientas de diagnóstico/prueba, no una API administrativa
    // de producción. Una clave válida no elimina esta restricción.
    if (environment !== 'development' && environment !== 'test') {
      throw new ForbiddenException(
        'Las herramientas de integración están deshabilitadas en este entorno.',
      );
    }

    const expected = this.configService
      .get<string>('INTEGRATIONS_ADMIN_KEY')
      ?.trim();
    // Clave aleatoria de 32 bytes, representada por 64 caracteres hexadecimales.
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new ServiceUnavailableException(
        'Falta configurar una clave administrativa válida para integraciones.',
      );
    }

    const request = context.switchToHttp().getRequest<IntegrationRequest>();
    const supplied = request.headers['x-integrations-key'];
    if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) {
      throw new UnauthorizedException('Credencial administrativa inválida.');
    }

    const expectedDigest = createHash('sha256')
      .update(expected, 'utf8')
      .digest();
    const suppliedDigest = createHash('sha256')
      .update(supplied, 'utf8')
      .digest();
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException('Credencial administrativa inválida.');
    }

    return true;
  }
}
