import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV!: Environment;

  @IsNumber()
  @Min(0)
  @Max(65535)
  PORT!: number;

  @IsString()
  API_PREFIX!: string;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  CORS_ALLOWED_ORIGINS!: string;

  @IsOptional()
  @IsString()
  ZOHO_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  ZOHO_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  ZOHO_REFRESH_TOKEN?: string;

  @IsOptional()
  @IsString()
  ZOHO_ORGANIZATION_ID?: string;

  @IsOptional()
  @IsUrl()
  ZOHO_BOOKS_BASE_URL?: string;

  @IsOptional()
  @IsString()
  KHIPU_RECEIVER_ID?: string;

  @IsOptional()
  @IsString()
  KHIPU_SECRET_KEY?: string;

  @IsOptional()
  @IsUrl()
  KHIPU_BASE_URL?: string;

  @IsOptional()
  @IsString()
  PUBLIC_BACKEND_URL?: string;

  @IsOptional()
  @IsString()
  KHIPU_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  ZOHO_CUSTOMER_PAYMENT_MODE?: string;

  @IsOptional()
  @IsString()
  ZOHO_WRITE_PAYMENTS_ENABLED?: string;

  @IsOptional()
  @IsString()
  ZOHO_AUTO_SYNC_PAYMENTS_ENABLED?: string;

  @IsOptional()
  @IsString()
  KHIPU_PROVIDER?: string;

  @IsOptional()
  @IsString()
  KHIPU_API_KEY?: string;

  @IsOptional()
  @IsString()
  KHIPU_NOTIFY_API_VERSION?: string;

  @IsOptional()
  @IsString()
  KHIPU_AUTH_MODE?: string;

  @IsOptional()
  @IsString()
  KHIPU_VALIDATE_WEBHOOK_SIGNATURE?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
