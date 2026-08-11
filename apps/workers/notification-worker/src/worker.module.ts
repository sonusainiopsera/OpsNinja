import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { NotificationHandler } from './notification.handler';
import { SesEventHandler } from './ses-event.handler';
import { SqsConsumerService } from './sqs-consumer.service';
import { RateLimiterService } from './rate-limiter.service';
import { SesEmailSender } from './adapters/ses-email-sender';
import { EMAIL_SENDER, type EmailSenderPort } from './ports/email-sender.port';
import { SlaReminderHandler } from './handlers/sla-reminder.handler';

function createPool(): Pool {
  return new Pool({
    connectionString: process.env['DATABASE_URL'],
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

function createRateLimiter(): RateLimiterService {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  return new RateLimiterService(redisUrl);
}

function createSesEmailSender(): SesEmailSender {
  return new SesEmailSender();
}

@Module({
  providers: [
    {
      provide: Pool,
      useFactory: createPool,
    },
    {
      provide: RateLimiterService,
      useFactory: createRateLimiter,
    },
    {
      provide: EMAIL_SENDER,
      useFactory: createSesEmailSender,
    },
    {
      provide: NotificationHandler,
      useFactory: (pool: Pool, emailSender: SesEmailSender, rateLimiter: RateLimiterService) =>
        new NotificationHandler(pool, emailSender, rateLimiter),
      inject: [Pool, EMAIL_SENDER, RateLimiterService],
    },
    {
      provide: SesEventHandler,
      useFactory: (pool: Pool) => new SesEventHandler(pool),
      inject: [Pool],
    },
    {
      provide: SlaReminderHandler,
      useFactory: (pool: Pool, emailSender: EmailSenderPort) =>
        new SlaReminderHandler(pool, emailSender),
      inject: [Pool, EMAIL_SENDER],
    },
    SqsConsumerService,
  ],
})
export class WorkerModule {}
