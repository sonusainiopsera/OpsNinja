/**
 * AuditWriter — the single authoritative write path for audit_logs.
 *
 * Design invariants:
 *   1. Callers supply an externally-managed transaction handle (`sql`).
 *      AuditWriter never opens or commits a transaction.
 *   2. Advisory lock pg_advisory_xact_lock(lockId) serialises concurrent
 *      appends for the same tenant within a single Postgres connection.
 *      The lock is released automatically when the transaction ends.
 *   3. hash_prev is fetched from the optional Redis cache; on cache miss or
 *      Redis unavailability the authoritative last row is read from the DB
 *      using SELECT ... FOR SHARE inside the caller's transaction.
 *   4. hash_self = SHA-256(hash_prev || canonical_json(record)).
 *   5. before_state / after_state are truncated to 32 KB before insert.
 *
 * Injectable ports:
 *   - RedisHashCache (optional) — implement the interface to supply Redis;
 *     omit for environments where Redis is not available.
 *   - ClockFn — injectable clock for deterministic testing.
 *   - LoggerPort — structured logger (defaults to console).
 */

import type { Sql } from 'postgres';
import {
  computeChainHash,
  deriveChangedFields,
  GENESIS_HASH,
  truncateState,
  canonicalSerialize,
} from './audit-hash.js';

// ---------------------------------------------------------------------------
// Ports (injectable interfaces for testability)
// ---------------------------------------------------------------------------

export interface RedisHashCache {
  get(key: string): Promise<Buffer | null>;
  set(key: string, value: Buffer): Promise<void>;
}

export type ClockFn = () => Date;

export interface LoggerPort {
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface AuditRecord {
  tenantId: string;
  actorType: string;
  actorId?: string | null;
  actorDisplay?: string | null;
  actorRole?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  source?: string | null;
  traceId?: string | null;
  requestId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
}

export interface VerifyResult {
  ok: boolean;
  firstDivergentId: string | null;
  expectedHash: Buffer | null;
  actualHash: Buffer | null;
  checkedCount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** PostgreSQL hashtext() equivalent implemented in JS for advisory lock key. */
function advisoryLockId(tenantId: string): bigint {
  // Use a simple djb2 hash of the tenant ID string, bounded to int32.
  let hash = 5381;
  for (let i = 0; i < tenantId.length; i++) {
    hash = ((hash << 5) + hash + (tenantId.codePointAt(i) ?? 0)) | 0;
  }
  // pg_advisory_xact_lock takes bigint; use two int32 params for safety.
  return BigInt(hash >>> 0);
}

const DEFAULT_LOCK_RETRY_MS = 700;
const DEFAULT_LOCK_MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// AuditWriter
// ---------------------------------------------------------------------------

export class AuditWriter {
  private readonly redis: RedisHashCache | null;
  private readonly clock: ClockFn;
  private readonly logger: LoggerPort;

  constructor(options?: {
    redis?: RedisHashCache | null;
    clock?: ClockFn;
    logger?: LoggerPort;
  }) {
    this.redis = options?.redis ?? null;
    this.clock = options?.clock ?? (() => new Date());
    this.logger = options?.logger ?? {
      warn: (msg, ctx) => console.warn('[AuditWriter]', msg, ctx),
      error: (msg, ctx) => console.error('[AuditWriter]', msg, ctx),
    };
  }

  // -------------------------------------------------------------------------
  // append
  // -------------------------------------------------------------------------

  /**
   * Appends a single audit record within the caller's transaction.
   *
   * @param sql - postgres.js transaction handle (sql from sql.begin(...))
   * @param record - The audit record to append.
   */
  async append(sql: Sql, record: AuditRecord): Promise<void> {
    await this.appendBatch(sql, [record]);
  }

  // -------------------------------------------------------------------------
  // appendBatch
  // -------------------------------------------------------------------------

  /**
   * Appends multiple audit records within the caller's transaction.
   * Records are chained in the order supplied; all must belong to the same
   * tenant (enforcement: throws on mismatch).
   */
  async appendBatch(sql: Sql, records: readonly AuditRecord[]): Promise<void> {
    if (records.length === 0) return;

    // Validate single-tenant batch.
    const firstRecord = records[0];
    if (!firstRecord) return;
    const tenantId = firstRecord.tenantId;
    for (const r of records) {
      if (r.tenantId !== tenantId) {
        throw new Error(
          `appendBatch: all records must share the same tenantId; got ${tenantId} and ${r.tenantId}`,
        );
      }
    }

    // Acquire per-tenant advisory lock (transaction-scoped; auto-released on commit/rollback).
    await this.acquireAdvisoryLock(sql, tenantId);

    // Fetch the last hash for this tenant.
    let prevHash = await this.fetchLastHash(sql, tenantId);

    // Sort records by occurred_at so the chain matches verifyChain's read order.
    const sorted = [...records].sort((a, b) => {
      const at = (a.occurredAt ?? new Date(0)).getTime();
      const bt = (b.occurredAt ?? new Date(0)).getTime();
      return at - bt;
    });

    // Build and insert rows.
    for (const record of sorted) {
      const occurredAt = record.occurredAt ?? this.clock();
      const { payload: beforeState } = record.beforeState
        ? truncateState(record.beforeState)
        : { payload: null };
      const { payload: afterState } = record.afterState
        ? truncateState(record.afterState)
        : { payload: null };

      const changedFields = deriveChangedFields(
        record.beforeState ?? null,
        record.afterState ?? null,
      );

      // Compute hash over the canonical form of the row (excluding hash columns).
      const hashableRecord: Record<string, unknown> = {
        tenant_id: tenantId,
        actor_type: record.actorType,
        actor_id: record.actorId ?? null,
        actor_display: record.actorDisplay ?? null,
        actor_role: record.actorRole ?? null,
        action: record.action,
        resource_type: record.resourceType,
        resource_id: record.resourceId,
        before_state: beforeState,
        after_state: afterState,
        changed_fields: changedFields,
        source: record.source ?? null,
        trace_id: record.traceId ?? null,
        request_id: record.requestId ?? null,
        ip_hash: record.ipHash ?? null,
        user_agent: record.userAgent ?? null,
        occurred_at: occurredAt.toISOString(),
      };

      const hashSelf = computeChainHash(prevHash, hashableRecord);

      await sql`
        INSERT INTO audit_logs (
          tenant_id, id, occurred_at,
          actor_type, actor_id, actor_display, actor_role,
          action, resource_type, resource_id,
          before_state, after_state, changed_fields,
          source, trace_id, request_id, ip_hash, user_agent,
          hash_prev, hash_self
        ) VALUES (
          ${tenantId}::uuid,
          gen_random_uuid(),
          ${occurredAt.toISOString()}::timestamptz,
          ${record.actorType},
          ${record.actorId ?? null}::uuid,
          ${record.actorDisplay ?? null},
          ${record.actorRole ?? null},
          ${record.action},
          ${record.resourceType},
          ${record.resourceId}::uuid,
          ${beforeState !== null ? JSON.stringify(beforeState) : null}::jsonb,
          ${afterState !== null ? JSON.stringify(afterState) : null}::jsonb,
          ${changedFields.length > 0 ? changedFields : null}::text[],
          ${record.source ?? null},
          ${record.traceId ?? null},
          ${record.requestId ?? null},
          ${record.ipHash ?? null},
          ${record.userAgent ?? null},
          ${prevHash},
          ${hashSelf}
        )
      `;

      prevHash = hashSelf;
    }

    // Update Redis cache with the last hash (best-effort; non-fatal on failure).
    await this.cacheLastHash(tenantId, prevHash);
  }

  // -------------------------------------------------------------------------
  // verifyChain
  // -------------------------------------------------------------------------

  /**
   * Verifies the hash chain for a tenant over a time range.
   *
   * Reads all records in (occurred_at, id) order and recomputes hash_self for
   * each. Returns the first divergent record ID and the expected/actual hashes,
   * or { ok: true } if the chain is intact.
   *
   * @param sql      - A postgres.js connection (not necessarily inside a tx).
   * @param tenantId - The tenant to verify.
   * @param fromDate - Start of the range (inclusive).
   * @param toDate   - End of the range (exclusive).
   */
  async verifyChain(
    sql: Sql,
    tenantId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<VerifyResult> {
    type RowShape = {
      id: string;
      occurred_at: Date;
      actor_type: string;
      actor_id: string | null;
      actor_display: string | null;
      actor_role: string | null;
      action: string;
      resource_type: string;
      resource_id: string;
      before_state: unknown;
      after_state: unknown;
      changed_fields: string[] | null;
      source: string | null;
      trace_id: string | null;
      request_id: string | null;
      ip_hash: string | null;
      user_agent: string | null;
      hash_prev: Buffer | null;
      hash_self: Buffer | null;
    };

    const rows = await sql<RowShape[]>`
      SELECT
        id, occurred_at,
        actor_type, actor_id, actor_display, actor_role,
        action, resource_type, resource_id,
        before_state, after_state, changed_fields,
        source, trace_id, request_id, ip_hash, user_agent,
        hash_prev, hash_self
      FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid
        AND occurred_at >= ${fromDate.toISOString()}::timestamptz
        AND occurred_at <  ${toDate.toISOString()}::timestamptz
      ORDER BY occurred_at ASC, id ASC
    `;

    let prevHash: Buffer = GENESIS_HASH;
    let checkedCount = 0;

    for (const row of rows) {
      checkedCount++;
      const storedHashPrev = row.hash_prev ?? GENESIS_HASH;
      const storedHashSelf = row.hash_self;

      const hashableRecord: Record<string, unknown> = {
        tenant_id: tenantId,
        actor_type: row.actor_type,
        actor_id: row.actor_id,
        actor_display: row.actor_display,
        actor_role: row.actor_role,
        action: row.action,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        before_state: row.before_state ?? null,
        after_state: row.after_state ?? null,
        changed_fields: row.changed_fields,
        source: row.source,
        trace_id: row.trace_id,
        request_id: row.request_id,
        ip_hash: row.ip_hash,
        user_agent: row.user_agent,
        occurred_at: row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : String(row.occurred_at),
      };

      const expectedHash = computeChainHash(storedHashPrev, hashableRecord);

      if (!storedHashSelf || !expectedHash.equals(storedHashSelf)) {
        return {
          ok: false,
          firstDivergentId: row.id,
          expectedHash,
          actualHash: storedHashSelf ?? null,
          checkedCount,
        };
      }

      // Also check that hash_prev links correctly to the previous record.
      if (!storedHashPrev.equals(prevHash)) {
        return {
          ok: false,
          firstDivergentId: row.id,
          expectedHash: prevHash,
          actualHash: storedHashPrev,
          checkedCount,
        };
      }

      prevHash = expectedHash;
    }

    return { ok: true, firstDivergentId: null, expectedHash: null, actualHash: null, checkedCount };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async acquireAdvisoryLock(sql: Sql, tenantId: string): Promise<void> {
    const lockId = advisoryLockId(tenantId);

    for (let attempt = 0; attempt < DEFAULT_LOCK_MAX_ATTEMPTS; attempt++) {
      const [row] = await sql<[{ acquired: boolean }]>`
        SELECT pg_try_advisory_xact_lock(${lockId}::bigint) AS acquired
      `;
      if (row?.acquired) return;

      if (attempt < DEFAULT_LOCK_MAX_ATTEMPTS - 1) {
        await sleep(DEFAULT_LOCK_RETRY_MS);
      }
    }

    throw new AuditAdvisoryLockError(tenantId);
  }

  private async fetchLastHash(sql: Sql, tenantId: string): Promise<Buffer> {
    // Try Redis cache first.
    if (this.redis !== null) {
      try {
        const cached = await this.redis.get(`audit:chain:${tenantId}`);
        if (cached !== null) return cached;
      } catch (err) {
        this.logger.warn('audit:chain:redis-miss', {
          tenantId,
          reason: String(err),
        });
      }
    }

    // Authoritative fallback: read latest hash from DB.
    const rows = await sql<[{ hash_self: Buffer | null }?]>`
      SELECT hash_self
      FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
      FOR SHARE
    `;

    const row = rows[0];
    return row?.hash_self ?? GENESIS_HASH;
  }

  private async cacheLastHash(tenantId: string, hash: Buffer): Promise<void> {
    if (this.redis === null) return;
    try {
      await this.redis.set(`audit:chain:${tenantId}`, hash);
    } catch (err) {
      this.logger.warn('audit:chain:redis-set-failed', {
        tenantId,
        reason: String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class AuditAdvisoryLockError extends Error {
  constructor(tenantId: string) {
    super(
      `audit:advisory-lock-timeout: could not acquire chain lock for tenant ${tenantId} after ${DEFAULT_LOCK_MAX_ATTEMPTS} attempts`,
    );
    this.name = 'AuditAdvisoryLockError';
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Canonical serialiser re-export (convenience for callers)
// ---------------------------------------------------------------------------
export { canonicalSerialize };
