/**
 * RedisCacheService — thin cache wrapper with graceful degradation.
 *
 * All methods catch Redis errors and log at warn level; callers receive null
 * on any error so the request can fall through to the database.
 *
 * Injected REDIS_CLIENT is the global ioredis instance from RedisModule.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn('Redis GET error — bypassing cache', {
        key,
        message: (err as Error).message,
      });
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const serialised = JSON.stringify(value);
      await this.redis.setex(key, ttlSeconds, serialised);
    } catch (err) {
      this.logger.warn('Redis SET error — continuing without cache', {
        key,
        message: (err as Error).message,
      });
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn('Redis DEL error', { key, message: (err as Error).message });
    }
  }

  /** Delete all keys matching a pattern (uses SCAN to avoid blocking). */
  async delPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn('Redis SCAN/DEL error', { pattern, message: (err as Error).message });
    }
  }
}
