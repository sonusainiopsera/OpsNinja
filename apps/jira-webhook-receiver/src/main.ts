/**
 * jira-webhook-receiver — application entry point.
 *
 * Key differences from apps/api/main.ts:
 *  - rawBody: true — NestJS stores req.rawBody so HMAC is computed over exact bytes.
 *  - bodyParser limit 1MB — oversized payloads are rejected before the controller.
 *  - No global ValidationPipe, AuthGuard or TenantContextInterceptor.
 *  - No /api/v1 prefix — path is /webhooks/jira/:tenantSlug.
 *  - CORS disabled — this endpoint is called by Jira servers, not browsers.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

const PORT = parseInt(process.env['RECEIVER_PORT'] ?? '8090', 10);
const PAYLOAD_LIMIT = process.env['RECEIVER_PAYLOAD_LIMIT'] ?? '1mb';

async function bootstrap(): Promise<void> {
  const logger = new Logger('JiraWebhookReceiver');

  const app = await NestFactory.create(AppModule, {
    rawBody: true,         // Stores raw body buffer on req.rawBody for HMAC verification
    bodyParser: true,      // Enables built-in body parsing with the limit below
    logger: ['error', 'warn', 'log'],
  });

  // Enforce 1 MB hard limit at the framework layer. The controller also checks
  // this as a defence-in-depth measure.
  app.use(
    require('express').json({
      limit: PAYLOAD_LIMIT,
      // NestJS rawBody: true already registers the verify callback;
      // we just set the limit here.
    }),
  );

  // No global prefix — webhook URL is /webhooks/jira/:tenantSlug
  // No CORS — inbound from Jira servers only
  // No cookie parser — no session auth

  await app.listen(PORT);
  logger.log(`Jira webhook receiver listening on port ${PORT}`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
