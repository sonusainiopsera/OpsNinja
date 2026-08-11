import { createHash } from 'node:crypto';
import type { FilterAst, AstNode } from './ast';

/**
 * Compiler version — increment this whenever the compilation semantics change
 * so that cached results keyed by old signatures are automatically invalidated.
 */
export const COMPILER_VERSION = 1;

/**
 * Computes a stable, canonical SHA-256 signature of a FilterAst.
 *
 * Properties:
 * - Key ordering in JSON does not affect the result.
 * - Whitespace differences do not affect the result.
 * - Prefixed with "fc:v{version}:" so a compiler version bump invalidates all cached keys.
 * - Returns a hex string suitable as a Redis cache key.
 */
export function computeSignature(ast: FilterAst): string {
  const canonical = canonicalize(ast);
  const json = JSON.stringify(canonical);
  const hash = createHash('sha256').update(json, 'utf8').digest('hex');
  return `fc:v${COMPILER_VERSION}:${hash}`;
}

/**
 * Recursively sorts all object keys for canonical (key-order-independent) serialisation.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
