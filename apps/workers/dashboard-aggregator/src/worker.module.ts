/**
 * WorkerModule — NestJS DI module for the dashboard-aggregator worker.
 */

import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { AggregateStore } from './redis/aggregate.store';
import { SqsConsumerService } from './sqs-consumer.service';
import { ReconcilerService } from './reconcile/reconciler.service';

const PG_POOL = 'PG_POOL';
const REDIS_CLIENT = 'REDIS_CLIENT';

function createPool(): Pool {
  return new Pool({
    connectionString: process.env['DATABASE_URL'],
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

function createRedis(): Redis {
  return new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
  });
}

@Module({
  providers: [
    { provide: PG_POOL, useFactory: createPool },
    { provide: REDIS_CLIENT, useFactory: createRedis },

    {
      provide: AggregateStore,
      useFactory: (redis: Redis) => new AggregateStore(redis),
      inject: [REDIS_CLIENT],
    },

    {
      provide: SqsConsumerService,
      useFactory: (store: AggregateStore) => new SqsConsumerService(store),
      inject: [AggregateStore],
    },

    {
      provide: ReconcilerService,
      useFactory: (pool: Pool, redis: Redis, store: AggregateStore) =>
        new ReconcilerService(pool, redis, store),
      inject: [PG_POOL, REDIS_CLIENT, AggregateStore],
    },
  ],
})
export class WorkerModule {}
