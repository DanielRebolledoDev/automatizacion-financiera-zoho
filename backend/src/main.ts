import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseCorsOrigins } from './common/utils/cors.util';

type CorsCallback = (error: Error | null, allow?: boolean) => void;

function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT') ?? 3000;
  const apiPrefix = configService.get<string>('API_PREFIX') ?? 'api';

  const corsAllowedOriginsValue =
    configService.get<string>('CORS_ALLOWED_ORIGINS') ?? '';

  const corsAllowedOrigins = parseCorsOrigins(corsAllowedOriginsValue);

  app.setGlobalPrefix(apiPrefix);

  app.enableCors({
    origin: (origin: string | undefined, callback: CorsCallback): void => {
      if (isCorsOriginAllowed(origin, corsAllowedOrigins)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(port);

  console.log(`Backend running on http://localhost:${port}/${apiPrefix}`);
}

bootstrap();
