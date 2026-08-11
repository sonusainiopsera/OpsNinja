import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { setupOpenApi } from './openapi/openapi';

const GLOBAL_PREFIX = 'api/v1';
const BODY_LIMIT = '1mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Buffer logs until pino logger is attached
    bufferLogs: true,
  });

  // ── Attach pino logger ─────────────────────────────────────────────────────
  app.useLogger(app.get(Logger));

  // ── Route prefix ──────────────────────────────────────────────────────────
  app.setGlobalPrefix(GLOBAL_PREFIX);

  // ── Body size limits (express middleware) ─────────────────────────────────
  // Register before NestJS routing so oversized bodies are rejected early.
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  // ── Express error handler for body-parser errors (e.g. 413) ───────────────
  // This catches errors thrown by express middleware before they reach Nest
  // and injects them as NestJS-compatible errors that the global filter handles.
  app.use(
    (
      err: Error & { type?: string; status?: number },
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      if (err.type === 'entity.too.large') {
        // Re-throw as an object with the shape our exception filter recognises
        next(Object.assign(new Error('Payload too large'), { type: 'entity.too.large' }));
      } else {
        next(err);
      }
    },
  );

  // ── Global exception filter ────────────────────────────────────────────────
  // Must be registered AFTER the body-parser middleware so the express error
  // handler above runs first for 413 errors.
  app.useGlobalFilters(new AllExceptionsFilter());

  // ── OpenAPI document ───────────────────────────────────────────────────────
  setupOpenApi(app);

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  app.enableShutdownHooks();

  // ── Start listening ────────────────────────────────────────────────────────
  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3000;
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`OpsNinja API listening on port ${port} — prefix /${GLOBAL_PREFIX}`);
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal: application failed to start', err);
  process.exit(1);
});
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { TenantErrorFilter } from './common/filters/tenant-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new TenantErrorFilter());

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  console.log(`OpsNinja API listening on port ${port}`);
}

void bootstrap();
