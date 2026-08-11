/**
 * Redis client provider for the jira-webhook-receiver app.
 *
 * Mirrors apps/api/src/common/redis/redis.provider.ts but is self-contained
 * so the receiver has no dependency on the api app's module graph.
 */

import Redis, { type RedisOptions } from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export function createRedisClient(overrides?: Partial<RedisOptions>): Redis {
  const url = process.env['REDIS_URL'];
  const options: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    ...overrides,
  };
  return url ? new Redis(url, options) : new Redis(options);
}
