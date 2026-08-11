/**
 * AggregateStore — imperative shell that binds pure mutation commands to Redis.
 *
 * Loads the apply-event Lua script with SCRIPT LOAD on startup and invokes it
 * via EVALSHA on every event. The Lua script atomically:
 *   1. Attempts SET NX on the dedup key (7-day TTL).
 *   2. If claimed: applies all mutation commands from the array.
 *   3. Increments dash:{tenant}:meta seq.
 *
 * Also tracks active tenants in the reconciler's set and exposes typed read
 * helpers for the snapshot API.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type Redis from 'ioredis';
import { Keys, DEDUP_TTL_SECONDS, FEED_MAX } from './keys';

// Each mutation command is a tuple — first element is the Redis command name
export type MutationCmd =
  | ['HINCRBY', string, string, number]
  | ['ZINCRBY', string, number, string]
  | ['ZADD', string, 'GT' | 'NX', number, string]
  | ['ZREM', string, string]
  | ['LPUSH', string, string]
  | ['LTRIM', string, number, number]
  | ['HSET', string, string, string | number];

export interface ApplyResult {
  applied: boolean; // false = deduplicated
}

@Injectable()
export class AggregateStore implements OnModuleInit {
  private readonly logger = new Logger(AggregateStore.name);
  private scriptSha: string | null = null;

  constructor(private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    const luaPath = join(__dirname, 'lua', 'apply-event.lua');
    let script: string;
    try {
      script = readFileSync(luaPath, 'utf8');
    } catch {
      // In compiled dist the lua file may be at a different relative path
      const altPath = join(__dirname, '..', 'src', 'redis', 'lua', 'apply-event.lua');
      script = readFileSync(altPath, 'utf8');
    }
    this.scriptSha = await this.redis.script('LOAD', script) as string;
    this.logger.log('apply-event Lua script loaded', { sha: this.scriptSha });
  }

  /**
   * Apply a batch of mutation commands for a single event, atomically with
   * the dedup guard.
   */
  async applyEvent(
    tenantId: string,
    eventId: string,
    commands: MutationCmd[],
  ): Promise<ApplyResult> {
    if (!this.scriptSha) {
      throw new Error('Lua script not loaded — onModuleInit may not have run');
    }

    const dedupKey = Keys.dedup(tenantId, eventId);
    const metaKey = Keys.meta(tenantId);

    const result = await this.redis.evalsha(
      this.scriptSha,
      2,
      dedupKey,
      metaKey,
      String(DEDUP_TTL_SECONDS),
      JSON.stringify(commands),
    ) as number;

    if (result === 1) {
      // Record tenant as active for the reconciler
      await this.redis.sadd(Keys.activeTenants(), tenantId);
    }

    return { applied: result === 1 };
  }

  // --------------------------------------------------------------------------
  // Read helpers (used by snapshot API and reconciler)
  // --------------------------------------------------------------------------

  async getKpi(tenantId: string): Promise<Record<string, number>> {
    const raw = await this.redis.hgetall(Keys.kpi(tenantId));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = parseInt(v, 10) || 0;
    }
    return out;
  }

  async getCategoryBreakdown(tenantId: string): Promise<Array<{ category: string; count: number }>> {
    const raw = await this.redis.zrangebyscore(Keys.category(tenantId), '-inf', '+inf', 'WITHSCORES');
    const result: Array<{ category: string; count: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ category: raw[i]!, count: parseInt(raw[i + 1] ?? '0', 10) });
    }
    return result;
  }

  async getBreachRisk(tenantId: string, limit = 10): Promise<Array<{ ticketId: string; nextFireAt: number }>> {
    const raw = await this.redis.zrangebyscore(
      Keys.breachRisk(tenantId),
      '-inf',
      '+inf',
      'WITHSCORES',
      'LIMIT',
      0,
      limit,
    );
    const result: Array<{ ticketId: string; nextFireAt: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ ticketId: raw[i]!, nextFireAt: parseFloat(raw[i + 1] ?? '0') });
    }
    return result;
  }

  async getFeed(tenantId: string, limit = FEED_MAX): Promise<string[]> {
    return this.redis.lrange(Keys.feed(tenantId), 0, limit - 1);
  }

  async getMeta(tenantId: string): Promise<Record<string, string>> {
    return this.redis.hgetall(Keys.meta(tenantId));
  }

  /** Overwrite KPI hash entirely (used by reconciler). */
  async overwriteKpi(tenantId: string, kpi: Record<string, number>): Promise<void> {
    const flat: (string | number)[] = [];
    for (const [k, v] of Object.entries(kpi)) {
      flat.push(k, v);
    }
    if (flat.length > 0) {
      await this.redis.hset(Keys.kpi(tenantId), ...flat);
    }
    await this.redis.hset(Keys.meta(tenantId), 'source', 'reconciled', 'updatedAt', String(Date.now()));
    await this.redis.sadd(Keys.activeTenants(), tenantId);
  }

  /** Overwrite a sorted set entirely (used by reconciler for category/org_load). */
  async overwriteZset(key: string, members: Array<[number, string]>): Promise<void> {
    const pipe = this.redis.pipeline();
    pipe.del(key);
    if (members.length > 0) {
      const args: (string | number)[] = [];
      for (const [score, member] of members) {
        args.push(score, member);
      }
      pipe.zadd(key, ...args);
    }
    await pipe.exec();
  }
}
