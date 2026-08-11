/**
 * SlaPolicyResolver — resolves the best-matching active SLA policy for a ticket
 * with a 60-second Redis cache to stay within the 500 ms ticket-create budget.
 *
 * Cache key: sla:policy:{tenantId}:{scopeType}:{scopeId}:{priority}
 * TTL: 60 s for positive hits, 30 s for negative (no policy) hits.
 *
 * On Redis unavailability, RedisCacheService already degrades gracefully (returns
 * null on get / silently no-ops on set), so resolution falls through to Postgres.
 *
 * Resolution order:
 *   1. Organization-scoped policy matching priority (when organizationId provided)
 *   2. Tenant-scoped default policy matching priority
 *
 * Callers invoke invalidateForPolicy() after any policy write so the next
 * resolution gets a fresh value.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { SlaPolicy } from '@opsninja/db';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { RedisCacheService } from '../../infra/cache/redis-cache';

const CACHE_TTL_HIT_S = 60;
const CACHE_TTL_MISS_S = 30;
const NULL_SENTINEL = '__NULL__';

@Injectable()
export class SlaPolicyResolver {
  private readonly logger = new Logger(SlaPolicyResolver.name);

  constructor(
    private readonly repo: SlaPoliciesRepository,
    private readonly cache: RedisCacheService,
  ) {}

  /**
   * Resolve the best active policy for the given tenant + org + priority.
   * Returns null when no matching policy exists (graceful degradation).
   */
  async resolve(params: {
    tenantId: string;
    organizationId: string | null;
    priority: string;
  }): Promise<SlaPolicy | null> {
    const { tenantId, organizationId, priority } = params;

    // 1. Try org-scoped policy first.
    if (organizationId) {
      const orgPolicy = await this.lookupWithCache(tenantId, 'organization', organizationId, priority);
      if (orgPolicy !== null) return orgPolicy;
    }

    // 2. Fall back to tenant-wide default policy.
    return this.lookupWithCache(tenantId, 'tenant', null, priority);
  }

  /**
   * Invalidate the cached entry for a specific policy scope + priority.
   * Called from SlaPoliciesService after create/update/deactivate.
   */
  async invalidateForPolicy(
    tenantId: string,
    scopeType: string,
    scopeId: string | null,
    priority: string,
  ): Promise<void> {
    const key = this.cacheKey(tenantId, scopeType, scopeId, priority);
    await this.cache.del(key);
    this.logger.debug('SLA policy cache invalidated', { key });
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async lookupWithCache(
    tenantId: string,
    scopeType: string,
    scopeId: string | null,
    priority: string,
  ): Promise<SlaPolicy | null> {
    const key = this.cacheKey(tenantId, scopeType, scopeId, priority);

    // Try cache first.
    const raw = await this.cache.get<SlaPolicy | typeof NULL_SENTINEL>(key);
    if (raw !== null) {
      if (raw === NULL_SENTINEL) return null;
      return raw as SlaPolicy;
    }

    // Cache miss — query Postgres via the tenant-bound transaction.
    const policy = await this.repo.findActiveByScope(tenantId, scopeType, scopeId, priority);

    // Populate cache (positive or negative).
    if (policy !== null) {
      await this.cache.set(key, policy, CACHE_TTL_HIT_S);
    } else {
      await this.cache.set(key, NULL_SENTINEL, CACHE_TTL_MISS_S);
    }

    return policy;
  }

  private cacheKey(
    tenantId: string,
    scopeType: string,
    scopeId: string | null,
    priority: string,
  ): string {
    return `sla:policy:${tenantId}:${scopeType}:${scopeId ?? 'null'}:${priority}`;
  }
}
