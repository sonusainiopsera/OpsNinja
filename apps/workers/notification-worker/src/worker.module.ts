/**
 * WorkerModule – root NestJS module for the notification worker.
 *
 * Provides:
 *  - WORKER_DB_POOL: raw pg Pool for DB access (bypasses HTTP interceptors)
 *  - NOTIF_REDIS_CLIENT: Redis connection for rate limiting
 *  - EMAIL_SENDER_PORT: SesEmailSender (production) or InMemoryEmailSender (test)
 *  - NotificationHandler, NotificationTemplateService, TokenBucketService
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { NotificationHandler } from './notification.handler';
import { NotificationTemplateService } from './notification-template.service';
import { TokenBucketService, NOTIF_REDIS_CLIENT } from './rate-limit/token-bucket.service';
import { SesEmailSender } from './adapters/ses-email-sender';
import { EMAIL_SENDER_PORT } from './ports/email-sender.port';

export const WORKER_DB_POOL = 'WORKER_DB_POOL';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [
    {
      provide: WORKER_DB_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool =>
        new Pool({
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5432),
          database: config.get<string>('DB_NAME', 'opsninja'),
          user: config.get<string>('DB_USER', 'opsninja'),
          password: config.get<string>('DB_PASSWORD', ''),
          max: config.get<number>('DB_POOL_MAX', 5),
          connectionTimeoutMillis: 5_000,
        }),
    },
    {
      provide: NOTIF_REDIS_CLIENT,
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
      provide: EMAIL_SENDER_PORT,
      useClass: SesEmailSender,
    },
    NotificationTemplateService,
    TokenBucketService,
    NotificationHandler,
  ],
  exports: [NotificationHandler, EMAIL_SENDER_PORT, WORKER_DB_POOL],
})
export class WorkerModule {}
