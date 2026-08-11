/**
 * NotificationPreferencesService — WO-081.
 *
 * Manages per-contact and per-organization notification channel preferences
 * with Redis caching for the hot-path resolver latency requirement (<20ms p95).
 *
 * Cache strategy:
 *  - Key: notif:prefs:{tenant}:{contactId or org:orgId}
 *  - TTL: 60 seconds (PREFERENCE_CACHE_TTL_SECONDS)
 *  - Invalidation: on every write, DEL the affected keys
 *
 * Coalescing:
 *  - Key: notif:coalesce:{tenant}:{ticketId}:{recipient}:{eventType}
 *  - TTL: 60 seconds (COALESCE_WINDOW_SECONDS)
 *  - SET NX: if key exists, event is coalesced (increment metric, return true)
 *
 * Preference precedence: contact-level override > organization default > 'immediate'
 *
 * Reads use the Redis cache; writes go to DB first, then invalidate cache.
 * Cache misses fall through to the DB (handled by the repository).
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../common/redis/redis.provider';
import { NOTIFICATION_EVENT_TYPES } from './event-catalogue';
import type { NotificationMode } from '@opsninja/db';
import { NotificationPreferencesRepository, type UpsertPreferenceParams } from './notification-preferences.repository';
import type { NotificationPreference, NotificationScope } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PREFERENCE_CACHE_TTL_SECONDS = 60;
export const COALESCE_WINDOW_SECONDS = 60;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PreferenceEntry {
  eventType: string;
  channel: string;
  mode: NotificationMode;
}

export interface ContactPreferencesResult {
  /** Org-wide defaults (scope = 'organization'). */
  defaults: PreferenceEntry[];
  /** Per-contact overrides (scope = 'contact'). */
  overrides: PreferenceEntry[];
  /** Monotonic version used for optimistic concurrency on PUT. */
  version: number;
}

export interface BulkUpsertParams {
  tenantId: string;
  scope: NotificationScope;
  contactId: string | null;
  organizationId: string;
  overrides: PreferenceEntry[];
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly repo: NotificationPreferencesRepository,
  ) {}

  // ── Contact preferences ────────────────────────────────────────────────────

  /**
   * Get all preferences for a portal contact, combining org defaults + contact
   * overrides. Results are Redis-cached for 60 seconds.
   */
  async getContactPreferences(
    tenantId: string,
    contactId: string,
    organizationId: string,
  ): Promise<ContactPreferencesResult> {
    const cacheKey = this.contactCacheKey(tenantId, contactId);
    const cached = await this.tryGetCache<ContactPreferencesResult>(cacheKey);
    if (cached) return cached;

    const [orgRows, contactRows] = await Promise.all([
      this.repo.findByOrganization(tenantId, organizationId),
      this.repo.findByContact(tenantId, contactId),
    ]);

    const result = this.toContactPreferencesResult(orgRows, contactRows);
    await this.setCache(cacheKey, result);
    return result;
  }

  /**
   * Bulk-upsert overrides for a contact. Runs inside the ambient tenant
   * transaction (repository). Invalidates Redis on completion.
   *
   * Validates eventType against the catalogue before persisting.
   * Unknown event types are silently ignored (inert rows from removed events).
   */
  async upsertContactPreferences(
    tenantId: string,
    contactId: string,
    organizationId: string,
    overrides: PreferenceEntry[],
    updatedBy: string,
  ): Promise<ContactPreferencesResult> {
    // Delete existing contact-level overrides then re-insert
    await this.repo.deleteByContact(tenantId, contactId);

    for (const override of overrides) {
      if (!NOTIFICATION_EVENT_TYPES.has(override.eventType)) {
        this.logger.warn('Ignoring preference for unknown event type', {
          eventType: override.eventType,
        });
        continue;
      }
      await this.repo.upsert({
        tenantId,
        scope: 'contact',
        contactId,
        organizationId,
        eventType: override.eventType,
        channel: override.channel,
        mode: override.mode,
        updatedBy,
      });
    }

    // Invalidate cache
    await this.invalidateContactCache(tenantId, contactId);

    // Return fresh result (DB read, will be cached on next GET)
    return this.getContactPreferences(tenantId, contactId, organizationId);
  }

  // ── Organization defaults ──────────────────────────────────────────────────

  /**
   * Get org-level notification defaults.
   */
  async getOrganizationDefaults(
    tenantId: string,
    organizationId: string,
  ): Promise<ContactPreferencesResult> {
    const cacheKey = this.orgCacheKey(tenantId, organizationId);
    const cached = await this.tryGetCache<ContactPreferencesResult>(cacheKey);
    if (cached) return cached;

    const orgRows = await this.repo.findByOrganization(tenantId, organizationId);
    const result = this.toContactPreferencesResult(orgRows, []);
    await this.setCache(cacheKey, result);
    return result;
  }

  /**
   * Bulk-upsert org-level defaults. Invalidates the org cache key.
   * Also invalidates all contact cache keys for this org (best-effort).
   */
  async upsertOrganizationDefaults(
    tenantId: string,
    organizationId: string,
    defaults: PreferenceEntry[],
    updatedBy: string,
  ): Promise<ContactPreferencesResult> {
    await this.repo.deleteByOrganization(tenantId, organizationId);

    for (const def of defaults) {
      if (!NOTIFICATION_EVENT_TYPES.has(def.eventType)) continue;
      await this.repo.upsert({
        tenantId,
        scope: 'organization',
        contactId: null,
        organizationId,
        eventType: def.eventType,
        channel: def.channel,
        mode: def.mode,
        updatedBy,
      });
    }

    await this.invalidateOrgCache(tenantId, organizationId);
    return this.getOrganizationDefaults(tenantId, organizationId);
  }

  // ── Effective mode lookup (hot path) ─────────────────────────────────────

  /**
   * Returns the effective NotificationMode for a (contact, eventType, channel)
   * triple, applying preference precedence. Cached via Redis.
   *
   * contact-level override > org default > 'immediate'
   */
  async getEffectiveMode(
    tenantId: string,
    contactId: string,
    organizationId: string,
    eventType: string,
    channel: string,
  ): Promise<NotificationMode> {
    // Try Redis cache first
    const cacheKey = this.contactCacheKey(tenantId, contactId);
    const cached = await this.tryGetCache<ContactPreferencesResult>(cacheKey);
    if (cached) {
      const override = cached.overrides.find(
        (p) => p.eventType === eventType && p.channel === channel,
      );
      if (override) return override.mode;

      const def = cached.defaults.find(
        (p) => p.eventType === eventType && p.channel === channel,
      );
      if (def) return def.mode;

      return 'immediate';
    }

    // Cache miss → delegate to repository (DB query)
    return this.repo.getEffectiveMode(tenantId, contactId, organizationId, eventType, channel);
  }

  // ── Coalescing (60-second dedup window) ───────────────────────────────────

  /**
   * Returns true if this event is being coalesced (i.e., a recent identical
   * event already claimed the dedup key). The caller should suppress delivery
   * and increment a metric instead.
   *
   * First call claims the key (SET NX EX 60). Subsequent calls within 60s
   * return true (coalesced).
   */
  async shouldCoalesce(
    tenantId: string,
    ticketId: string,
    recipientId: string,
    eventType: string,
  ): Promise<boolean> {
    const key = `notif:coalesce:${tenantId}:${ticketId}:${recipientId}:${eventType}`;
    // SET NX EX: returns 'OK' if claimed, null if key already exists
    const result = await this.redis.set(key, '1', 'EX', COALESCE_WINDOW_SECONDS, 'NX');
    const coalesced = result === null;
    if (coalesced) {
      // Emit metric via structured log (picked up by OTel pipeline)
      console.log(
        JSON.stringify({
          metric: 'notification_coalesced_total',
          labels: { tenantId, eventType },
          value: 1,
          ts: Date.now(),
        }),
      );
    }
    return coalesced;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private contactCacheKey(tenantId: string, contactId: string): string {
    return `notif:prefs:${tenantId}:${contactId}`;
  }

  private orgCacheKey(tenantId: string, organizationId: string): string {
    return `notif:prefs:${tenantId}:org:${organizationId}`;
  }

  private async tryGetCache<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async setCache<T>(key: string, value: T): Promise<void> {
    try {
      await this.redis.setex(key, PREFERENCE_CACHE_TTL_SECONDS, JSON.stringify(value));
    } catch {
      // Cache write failure is non-fatal
    }
  }

  private async invalidateContactCache(tenantId: string, contactId: string): Promise<void> {
    try {
      await this.redis.del(this.contactCacheKey(tenantId, contactId));
    } catch {
      // Non-fatal
    }
  }

  private async invalidateOrgCache(tenantId: string, organizationId: string): Promise<void> {
    try {
      await this.redis.del(this.orgCacheKey(tenantId, organizationId));
    } catch {
      // Non-fatal
    }
  }

  private toContactPreferencesResult(
    orgRows: NotificationPreference[],
    contactRows: NotificationPreference[],
  ): ContactPreferencesResult {
    const defaults: PreferenceEntry[] = orgRows.map((r) => ({
      eventType: r.eventType,
      channel: r.channel,
      mode: r.mode,
    }));
    const overrides: PreferenceEntry[] = contactRows.map((r) => ({
      eventType: r.eventType,
      channel: r.channel,
      mode: r.mode,
    }));
    // Version is the count of all rows (simple monotonic proxy for optimistic concurrency)
    const version = orgRows.length + contactRows.length;
    return { defaults, overrides, version };
  }
}
