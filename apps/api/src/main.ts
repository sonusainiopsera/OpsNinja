/**
 * OpsNinja API — application entry point.
 *
 * Bootstraps the NestJS application with global validation, CORS, and the
 * versioned API prefix. All interceptors and guards registered in AppModule
 * are applied globally.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { createLogger } from '@opsninja/observability';

const PORT = parseInt(process.env['PORT'] ?? '8080', 10);
const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: createLogger({ context: 'Bootstrap' }),
  });

  // Global validation pipe — rejects unknown properties and validates DTOs.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Cookie parser — required for httpOnly refresh token cookies.
  app.use(cookieParser());

  // Versioned API prefix.
  app.setGlobalPrefix('api/v1');

  // CORS — locked down in production via environment variable.
  app.enableCors({
    origin: process.env['CORS_ORIGINS']?.split(',') ?? false,
    credentials: true,
  });

  await app.listen(PORT);
  logger.log(`OpsNinja API listening on port ${PORT}`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
