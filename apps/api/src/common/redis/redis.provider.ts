/**
 * Redis client provider using ioredis.
 *
 * The singleton client is shared across all modules. ioredis handles
 * reconnection automatically. If Redis is unavailable at startup the
 * provider logs a warning but does not crash — auth endpoints will fail
 * closed with 503 when they attempt to use the client.
 *
 * Exported token for injection: REDIS_CLIENT
 */

import Redis, { RedisOptions } from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export function createRedisClient(overrides?: Partial<RedisOptions>): Redis {
  const url = process.env['REDIS_URL'];

  const options: RedisOptions = {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 100, 3_000),
    ...overrides,
  };

  const client = url ? new Redis(url, options) : new Redis(options);

  client.on('error', (err: Error) => {
    console.error('[redis] Client error', { message: err.message });
  });

  client.on('connect', () => {
    console.log('[redis] Connected');
  });

  return client;
}

export const redisProvider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis => createRedisClient(),
};
