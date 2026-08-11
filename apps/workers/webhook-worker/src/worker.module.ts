/**
 * WebhookWorkerModule – root NestJS module for the webhook delivery worker.
 *
 * Provides:
 *  - WEBHOOK_DB_POOL:    pg Pool for DB access
 *  - WEBHOOK_REDIS:      Redis for concurrency semaphore + rate limit
 *  - WebhookDeliveryHandler
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { ENVELOPE_CIPHER_PORT, KmsEnvelopeCipher } from '@opsninja/crypto';
import { WebhookDeliveryHandler } from './delivery.handler';

export const WEBHOOK_DB_POOL = 'WEBHOOK_DB_POOL';
export const WEBHOOK_REDIS = 'WEBHOOK_REDIS';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [
    {
      provide: WEBHOOK_DB_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool =>
        new Pool({
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5432),
          database: config.get<string>('DB_NAME', 'opsninja'),
          user: config.get<string>('DB_USER', 'opsninja'),
          password: config.get<string>('DB_PASSWORD', ''),
          max: config.get<number>('DB_POOL_MAX', 10),
          connectionTimeoutMillis: 5_000,
        }),
    },
    {
      provide: WEBHOOK_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 3,
        }),
    },
    {
      provide: ENVELOPE_CIPHER_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new KmsEnvelopeCipher(config),
    },
    WebhookDeliveryHandler,
  ],
  exports: [WebhookDeliveryHandler],
})
export class WebhookWorkerModule {}
