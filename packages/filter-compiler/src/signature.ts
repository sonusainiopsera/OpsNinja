/**
 * Deterministic signature for a FilterAst.
 *
 * Algorithm:
 *   1. Canonicalise: deep-sort object keys, remove insignificant whitespace.
 *   2. Serialize to JSON.
 *   3. SHA-256 hash the UTF-8 bytes.
 *   4. Prefix with "fc-v1:" so a compiler version change invalidates all cached results.
 *
 * The signature is suitable as a Redis cache key prefix.
 * Tests assert stability under key reordering and whitespace variation.
 */

import { createHash } from 'crypto';

import { type FilterAst, type FilterNode } from './ast';

const COMPILER_VERSION = 'fc-v1';

// ---------------------------------------------------------------------------
// Canonical JSON serialisation
// ---------------------------------------------------------------------------

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalJSON(ast: FilterNode): string {
  return JSON.stringify(sortKeys(ast));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a stable SHA-256 signature for the AST, independent of key ordering.
 * Prefixed with the compiler version so a compiler change invalidates all caches.
 */
export function computeSignature(ast: FilterAst): string {
  const canonical = canonicalJSON(ast);
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `${COMPILER_VERSION}:${hash}`;
}
