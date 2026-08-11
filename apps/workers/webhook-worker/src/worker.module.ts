import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { KmsEnvelopeCipher, ENVELOPE_CIPHER } from '@opsninja/crypto';

import { DeliveryHandler } from './delivery.handler';
import { SqsConsumerService } from './sqs-consumer.service';
import { RedisGating } from './redis-gating';

function createPool(): Pool {
  return new Pool({
    connectionString: process.env['DATABASE_URL'],
    max: parseInt(process.env['DB_POOL_MAX'] ?? '10', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

function createRedis(): Redis {
  return new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3_000),
  });
}

@Module({
  providers: [
    { provide: Pool, useFactory: createPool },
    {
      provide: Redis,
      useFactory: createRedis,
    },
    {
      provide: ENVELOPE_CIPHER,
      useFactory: () =>
        new KmsEnvelopeCipher(
          process.env['KMS_WEBHOOK_KEY_ARN'] ??
            'arn:aws:kms:us-east-1:000000000000:key/placeholder',
        ),
    },
    {
      provide: RedisGating,
      useFactory: (redis: Redis) => new RedisGating(redis),
      inject: [Redis],
    },
    {
      provide: DeliveryHandler,
      useFactory: (pool: Pool, cipher: InstanceType<typeof KmsEnvelopeCipher>, gating: RedisGating) =>
        new DeliveryHandler(pool, cipher, gating),
      inject: [Pool, ENVELOPE_CIPHER, RedisGating],
    },
    SqsConsumerService,
  ],
})
export class WorkerModule {}
