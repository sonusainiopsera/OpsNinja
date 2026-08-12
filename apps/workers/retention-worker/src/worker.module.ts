/**
 * WorkerModule — NestJS module for the nightly retention worker.
 *
 * Provides:
 *   - pg Pool bound to the primary DB (write needed for job-run records + partition DDL)
 *   - Redis client for the distributed lock
 *   - RetentionJob wired with the two above
 */

import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { RetentionJob } from './retention.job';

const DB_POOL_TOKEN    = 'DB_POOL';
const REDIS_TOKEN      = 'REDIS_CLIENT';

@Module({
  providers: [
    {
      provide: DB_POOL_TOKEN,
      useFactory: () =>
        new Pool({
          connectionString: process.env['DATABASE_URL'],
          max: 5,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        }),
    },
    {
      provide: REDIS_TOKEN,
      useFactory: () =>
        new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        }),
    },
    {
      provide: RetentionJob,
      useFactory: (pool: Pool, redis: Redis) => new RetentionJob(pool, redis),
      inject: [DB_POOL_TOKEN, REDIS_TOKEN],
    },
  ],
  exports: [RetentionJob],
})
export class WorkerModule {}
