/**
 * WorkerModule — NestJS module wiring all providers for the jira-sync worker.
 *
 * Infrastructure resolved from environment variables:
 *   DATABASE_URL          — PostgreSQL connection string
 *   REDIS_URL             — Redis connection string
 *   JIRA_SYNC_QUEUE_URL   — SQS queue URL for jira-sync events
 *   AWS_REGION            — AWS region (default: us-east-1)
 *
 * Providers:
 *   pg.Pool               — injected as 'PG_POOL'
 *   ioredis               — injected as 'REDIS'
 *   SQSClient             — injected as 'SQS_CLIENT'
 *   SqsConsumerConfig     — injected as 'SQS_CONSUMER_CONFIG'
 *   InboundHandler        — inbound Jira webhook pipeline
 *   OutboundHandler       — outbound Jira sync pipeline
 *   JiraOperationsService — thin Jira HTTP client
 *   JiraRateLimiter       — per-tenant Redis token bucket
 *   SqsConsumerService    — SQS long-polling loop
 */

import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsConsumerService } from './sqs-consumer.service';
import { InboundHandler } from './inbound/inbound.handler';
import { OutboundHandler } from './outbound/outbound.handler';
import { JiraOperationsService } from './outbound/jira-operations.service';
import { JiraRateLimiter } from './outbound/rate-limiter';
import type { SqsConsumerConfig } from './sqs-consumer.service';

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

export const PG_POOL      = 'PG_POOL';
export const REDIS_CLIENT = 'REDIS_CLIENT';
export const SQS_CLIENT   = 'SQS_CLIENT';
export const SQS_CONFIG   = 'SQS_CONFIG';

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

@Module({
  providers: [
    // ── PostgreSQL pool ───────────────────────────────────────────────────
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({
          connectionString: process.env['DATABASE_URL'],
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        }),
    },

    // ── Redis ─────────────────────────────────────────────────────────────
    {
      provide: REDIS_CLIENT,
      useFactory: () =>
        new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
          lazyConnect: true,
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
        }),
    },

    // ── SQS client ────────────────────────────────────────────────────────
    {
      provide: SQS_CLIENT,
      useFactory: () =>
        new SQSClient({
          region: process.env['AWS_REGION'] ?? 'us-east-1',
        }),
    },

    // ── SQS consumer config ───────────────────────────────────────────────
    {
      provide: SQS_CONFIG,
      useFactory: (): SqsConsumerConfig => ({
        queueUrl: process.env['JIRA_SYNC_QUEUE_URL'] ?? '',
        batchSize: 1,
        waitTimeSeconds: 20,
        visibilityTimeoutSeconds: 60,
      }),
    },

    // ── Application services ──────────────────────────────────────────────
    {
      provide: JiraRateLimiter,
      useFactory: (redis: Redis) => new JiraRateLimiter(redis),
      inject: [REDIS_CLIENT],
    },

    {
      provide: JiraOperationsService,
      useClass: JiraOperationsService,
    },

    {
      provide: InboundHandler,
      useFactory: (pool: Pool, redis: Redis) => new InboundHandler(pool, redis),
      inject: [PG_POOL, REDIS_CLIENT],
    },

    {
      provide: OutboundHandler,
      useFactory: (
        pool: Pool,
        redis: Redis,
        jiraOps: JiraOperationsService,
        rateLimiter: JiraRateLimiter,
        sqsClient: SQSClient,
        config: SqsConsumerConfig,
      ) =>
        new OutboundHandler(pool, redis, jiraOps, rateLimiter, sqsClient, config.queueUrl),
      inject: [PG_POOL, REDIS_CLIENT, JiraOperationsService, JiraRateLimiter, SQS_CLIENT, SQS_CONFIG],
    },

    {
      provide: SqsConsumerService,
      useFactory: (
        sqsClient: SQSClient,
        config: SqsConsumerConfig,
        inbound: InboundHandler,
        outbound: OutboundHandler,
      ) => new SqsConsumerService(sqsClient, config, inbound, outbound),
      inject: [SQS_CLIENT, SQS_CONFIG, InboundHandler, OutboundHandler],
    },
  ],
})
export class WorkerModule implements OnModuleInit {
  constructor(
    @Inject(SqsConsumerService) private readonly consumer: SqsConsumerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.start();
  }
}
