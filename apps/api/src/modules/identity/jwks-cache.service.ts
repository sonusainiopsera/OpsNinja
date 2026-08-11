/**
 * JwksCacheService — JWKS key retrieval with per-endpoint caching.
 *
 * Responsibilities:
 *   - Fetch and cache JWKS keys by jwks_uri (shared across OidcService instances).
 *   - Rotate-aware refetch: if a kid is unknown, refresh once, then negative-cache
 *     it so unknown kids do not trigger repeated fetches (DoS guard).
 *   - Single-flight: concurrent requests for the same endpoint share one fetch.
 *
 * Security invariants:
 *   - Keys are looked up by kid from the token header; tokens with no matching
 *     key in the cache are retried once, then rejected.
 *   - A kid that is absent after refresh is added to a negative cache; no
 *     further fetches will be triggered for that kid within the cache TTL.
 */

import { importJWK, type KeyLike } from 'jose';

export type FetchFn = typeof fetch;

export class JwksCacheError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'JwksCacheError';
  }
}

// Per-endpoint cache entry
interface CacheEntry {
  keys: Record<string, unknown>[];
  fetchedAt: number;
  negativeKids: Set<string>;
  inFlight: Promise<Record<string, unknown>[]> | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class JwksCacheService {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly fetchFn: FetchFn;

  constructor(opts?: { ttlMs?: number; fetchFn?: FetchFn }) {
    this.ttlMs = opts?.ttlMs ?? 5 * 60 * 1000;
    this.fetchFn = opts?.fetchFn ?? fetch;
  }

  /**
   * Returns the CryptoKey for a token header's kid from the given jwks_uri.
   * Rotates once on cache miss before failing with a distinct error.
   */
  async getVerificationKey(
    jwksUri: string,
    kid: string | undefined,
  ): Promise<KeyLike> {
    let entry = this.entry(jwksUri);

    // Negative-cache guard
    if (kid && entry.negativeKids.has(kid)) {
      throw new JwksCacheError('JWKS_KEY_UNKNOWN', `kid '${kid}' is in negative cache`);
    }

    let keys = await this.ensureKeys(jwksUri, entry);
    let match = findKey(keys, kid);

    if (!match && kid) {
      // One rotation attempt
      entry.fetchedAt = 0;
      keys = await this.ensureKeys(jwksUri, entry);
      match = findKey(keys, kid);
      if (!match) {
        entry.negativeKids.add(kid);
        throw new JwksCacheError('JWKS_KEY_UNKNOWN', `kid '${kid}' not found after refresh`);
      }
    }

    if (!match) {
      throw new JwksCacheError('JWKS_NO_KEY', 'No JWKS key found');
    }

    try {
      return importJWK(match as Parameters<typeof importJWK>[0]) as Promise<KeyLike>;
    } catch (e) {
      throw new JwksCacheError('JWKS_IMPORT_FAILED', 'Failed to import JWKS key', e);
    }
  }

  /** Forces a cache eviction (or full clear). */
  clearCache(jwksUri?: string): void {
    if (jwksUri !== undefined) {
      this.entries.delete(jwksUri);
    } else {
      this.entries.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private entry(jwksUri: string): CacheEntry {
    let e = this.entries.get(jwksUri);
    if (!e) {
      e = { keys: [], fetchedAt: 0, negativeKids: new Set(), inFlight: null };
      this.entries.set(jwksUri, e);
    }
    return e;
  }

  private async ensureKeys(
    jwksUri: string,
    entry: CacheEntry,
  ): Promise<Record<string, unknown>[]> {
    const now = Date.now();
    if (entry.keys.length > 0 && now - entry.fetchedAt < this.ttlMs) {
      return entry.keys;
    }

    // Single-flight: reuse in-progress fetch
    if (entry.inFlight) return entry.inFlight;

    entry.inFlight = this.fetch(jwksUri).then((keys) => {
      entry.keys = keys;
      entry.fetchedAt = Date.now();
      entry.inFlight = null;
      return keys;
    }).catch((e: unknown) => {
      entry.inFlight = null;
      throw e;
    });

    return entry.inFlight;
  }

  private async fetch(jwksUri: string): Promise<Record<string, unknown>[]> {
    let resp: Response;
    try {
      resp = await this.fetchFn(jwksUri);
    } catch (e) {
      throw new JwksCacheError('JWKS_FETCH_FAILED', `Cannot reach JWKS endpoint: ${jwksUri}`, e);
    }
    if (!resp.ok) {
      throw new JwksCacheError('JWKS_FETCH_ERROR', `JWKS returned ${resp.status}`);
    }
    const body = (await resp.json()) as { keys?: Record<string, unknown>[] };
    return body.keys ?? [];
  }
}

function findKey(
  keys: Record<string, unknown>[],
  kid: string | undefined,
): Record<string, unknown> | undefined {
  if (!kid) return keys[0];
  return keys.find((k) => k['kid'] === kid);
}
