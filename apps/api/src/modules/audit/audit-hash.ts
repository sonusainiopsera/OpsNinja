/**
 * Pure audit hash-chain helpers.
 *
 * No framework coupling — all functions are pure and synchronous so they are
 * testable without a database or any I/O setup.
 *
 * Chain design:
 *   hash_self = SHA-256(hash_prev_bytes || utf8(canonical_json(record)))
 *
 * "canonical_json" sorts object keys, uses ISO-8601 UTC timestamps for Date
 * values, and excludes the hash_prev/hash_self fields so the hash covers only
 * business data.
 *
 * Genesis value: 32 zero bytes — used when there is no previous record for
 * a tenant. Verification logic has no special case at the start of the chain.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** 32 zero bytes used as hash_prev for the first record of a tenant. */
export const GENESIS_HASH: Buffer = Buffer.alloc(32);

/**
 * Maximum byte size of before_state / after_state before truncation.
 * Matches AC requirement (32 KB).
 */
export const MAX_STATE_BYTES = 32 * 1024; // 32 KB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fields excluded from canonical serialisation (they contain the chain). */
const EXCLUDED_HASH_FIELDS = new Set(['hash_prev', 'hash_self', 'hashPrev', 'hashSelf']);

// ---------------------------------------------------------------------------
// canonicalSerialize
// ---------------------------------------------------------------------------

/**
 * Produces a stable, reproducible JSON string from a record:
 *   - Object keys are sorted recursively.
 *   - Date values are serialised as ISO-8601 UTC strings.
 *   - hash_prev / hash_self fields are excluded.
 *   - Buffer values are serialised as hex strings.
 *
 * The output is deterministic across Node.js versions for the same input.
 */
export function canonicalSerialize(record: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(record));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (!EXCLUDED_HASH_FIELDS.has(key)) {
        sorted[key] = canonicalize(obj[key]);
      }
    }
    return sorted;
  }
  return value;
}

// ---------------------------------------------------------------------------
// computeChainHash
// ---------------------------------------------------------------------------

/**
 * Computes hash_self = SHA-256(prev_bytes || utf8(canonical_json(record))).
 *
 * @param prevHash - hash_self of the previous record, or GENESIS_HASH for the
 *                   first record of a tenant.
 * @param record   - The audit record (without hash fields; they are excluded
 *                   by canonicalSerialize regardless).
 */
export function computeChainHash(
  prevHash: Buffer,
  record: Record<string, unknown>,
): Buffer {
  const canonical = canonicalSerialize(record);
  return createHash('sha256')
    .update(prevHash)
    .update(canonical, 'utf8')
    .digest();
}

// ---------------------------------------------------------------------------
// deriveChangedFields
// ---------------------------------------------------------------------------

/**
 * Returns an array of field names whose values differ between before and after.
 *
 * Comparison is by JSON serialisation (deep equality). Fields present only in
 * before (deleted) or only in after (added) are included.
 *
 * @param before - State before the mutation, or null for create events.
 * @param after  - State after the mutation, or null for delete events.
 */
export function deriveChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  if (!before && !after) return [];
  if (!before) return Object.keys(after ?? {});
  if (!after) return Object.keys(before);

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const bVal = JSON.stringify(before[key] ?? null);
    const aVal = JSON.stringify(after[key] ?? null);
    if (bVal !== aVal) changed.push(key);
  }
  return changed.sort();
}

// ---------------------------------------------------------------------------
// truncateState
// ---------------------------------------------------------------------------

export interface TruncateResult {
  payload: Record<string, unknown>;
  truncated: boolean;
}

/**
 * Truncates a JSON state payload to limitBytes.
 *
 * If the canonical JSON representation of `payload` exceeds `limitBytes`,
 * returns a replacement object with `{ _truncated: true, _original_size: N }`
 * so the audit record is never lost and truncation is machine-detectable.
 *
 * @param payload    - The JSON object to potentially truncate.
 * @param limitBytes - Maximum byte size (default 32 KB).
 */
export function truncateState(
  payload: Record<string, unknown>,
  limitBytes: number = MAX_STATE_BYTES,
): TruncateResult {
  const serialised = JSON.stringify(payload);
  if (Buffer.byteLength(serialised, 'utf8') <= limitBytes) {
    return { payload, truncated: false };
  }
  return {
    payload: {
      _truncated: true,
      _original_size: Buffer.byteLength(serialised, 'utf8'),
    },
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// partitionName
// ---------------------------------------------------------------------------

/**
 * Returns the expected audit_logs partition name for a given Date.
 * Example: new Date('2026-03-15') → 'audit_logs_2026_03'
 */
export function partitionName(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `audit_logs_${y}_${m}`;
}
