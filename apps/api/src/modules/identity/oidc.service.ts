/**
 * OidcService — OIDC Authorization Code + PKCE flow.
 *
 * Responsibilities:
 *   1. Discovers the OIDC provider's configuration (with in-memory caching).
 *   2. Generates and stores PKCE code verifier + nonce (single-use, TTL 10 min).
 *   3. Builds the authorization URL with PKCE S256 code challenge.
 *   4. Exchanges the authorization code for tokens.
 *   5. Validates the ID token (issuer, audience, nonce, expiry, signature).
 *
 * Security invariants:
 *   - PKCE state is single-use: deleted before validation to prevent replay.
 *   - Code verifier and nonce must never be logged.
 *   - ID token validation uses cached JWKS; unknown kid does NOT trigger a
 *     fresh fetch (negative-cache guard to prevent kid-storm DoS).
 *
 * Ports:
 *   - KeyValueStore  — stores PKCE state; in-memory for tests, Redis in prod.
 *   - FetchFn        — injectable fetch for testability (default: globalThis.fetch).
 *
 * The OIDC discovery document and JWKS are cached with a background refresh
 * controlled by discoveryTtlMs (default 5 min).
 */

import { createHash, randomBytes } from 'node:crypto';
import { importJWK, jwtVerify, type JWTPayload } from 'jose';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export type FetchFn = typeof fetch;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface OidcConfig {
  /** Provider base URL (e.g. https://accounts.google.com). */
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  /** Scopes to request. Defaults to ['openid', 'email', 'profile']. */
  scopes?: string[];
  /** Discovery document cache TTL in ms. Default 5 min. */
  discoveryTtlMs?: number;
  /** PKCE state TTL in seconds. Default 600 (10 min). */
  pkceStateTtlSeconds?: number;
  /** Clock-skew leeway for ID-token validation in seconds. Default 60. */
  clockSkewSeconds?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface PkceState {
  /** SHA-256 (S256) challenge derived from the code_verifier. */
  s256Challenge: string;
  nonce: string;
  redirectTo?: string;
}

export interface BuildAuthorizationUrlResult {
  authorizationUrl: string;
  /** Raw code verifier — must be presented unchanged at the callback. */
  codeVerifier: string;
}

export interface IdTokenClaims extends JWTPayload {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  nonce?: string;
}

export interface TokenExchangeResult {
  idTokenClaims: IdTokenClaims;
  accessToken?: string;
}

export class OidcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OidcService {
  private readonly config: Required<OidcConfig>;
  private readonly store: KeyValueStore;
  private readonly fetchFn: FetchFn;

  private cachedDiscovery: OidcDiscovery | null = null;
  private discoveryFetchedAt = 0;
  private cachedJwks: Record<string, unknown>[] | null = null;
  private jwksFetchedAt = 0;
  private readonly negativeKidCache = new Set<string>();

  constructor(config: OidcConfig, store: KeyValueStore, fetchFn: FetchFn = fetch) {
    this.config = {
      ...config,
      scopes: config.scopes ?? ['openid', 'email', 'profile'],
      discoveryTtlMs: config.discoveryTtlMs ?? 5 * 60 * 1000,
      pkceStateTtlSeconds: config.pkceStateTtlSeconds ?? 600,
      clockSkewSeconds: config.clockSkewSeconds ?? 60,
    };
    this.store = store;
    this.fetchFn = fetchFn;
  }

  /**
   * Generates a PKCE state (verifier + nonce), stores the S256 challenge in
   * the KV store under the given state parameter, and returns both the
   * authorization URL and the raw code_verifier (which the caller must
   * present unchanged in the callback request).
   */
  async buildAuthorizationUrl(
    state: string,
    redirectTo?: string,
  ): Promise<BuildAuthorizationUrlResult> {
    // code_verifier: 43–128 char base64url from CSPRNG (PKCE spec §4.1)
    const codeVerifier = randomBytes(48).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const s256Challenge = this.s256Challenge(codeVerifier);

    const pkceState: PkceState = { s256Challenge, nonce, redirectTo };
    await this.store.set(
      this.stateKey(state),
      JSON.stringify(pkceState),
      this.config.pkceStateTtlSeconds,
    );

    const discovery = await this.discover();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state,
      nonce,
      code_challenge: s256Challenge,
      code_challenge_method: 'S256',
    });

    return {
      authorizationUrl: `${discovery.authorization_endpoint}?${params.toString()}`,
      codeVerifier,
    };
  }

  /**
   * Exchanges the authorization code for tokens and validates the ID token.
   *
   * The PKCE state is deleted BEFORE validation (single-use semantics).
   * If validation fails after deletion, the state cannot be replayed.
   *
   * @param codeVerifier - Raw verifier presented by the client; must hash to
   *   the S256 challenge stored at login time.
   */
  async exchangeCode(
    code: string,
    state: string,
    codeVerifier: string,
  ): Promise<TokenExchangeResult> {
    const stateKey = this.stateKey(state);
    const stateJson = await this.store.get(stateKey);
    if (!stateJson) {
      throw new OidcError('AUTH_STATE_INVALID', 'PKCE state not found or expired');
    }

    // Single-use: delete before validation
    await this.store.del(stateKey);

    let pkceState: PkceState;
    try {
      pkceState = JSON.parse(stateJson) as PkceState;
    } catch {
      throw new OidcError('AUTH_STATE_INVALID', 'Corrupt PKCE state');
    }

    // Validate code_verifier against stored S256 challenge
    const computedChallenge = this.s256Challenge(codeVerifier);
    if (computedChallenge !== pkceState.s256Challenge) {
      throw new OidcError('AUTH_STATE_INVALID', 'Code verifier does not match stored challenge');
    }

    const discovery = await this.discover();
    const tokenResponse = await this.fetchTokens(
      discovery.token_endpoint,
      code,
      codeVerifier,
    );

    const idTokenClaims = await this.validateIdToken(
      tokenResponse.id_token,
      pkceState.nonce,
    );

    return { idTokenClaims, accessToken: tokenResponse.access_token };
  }

  /**
   * Validates an ID token against cached JWKS.
   * Throws OidcError on any validation failure.
   */
  async validateIdToken(idToken: string, expectedNonce: string): Promise<IdTokenClaims> {
    const jwks = await this.getJwks();

    // Extract the kid from the token header to find the right key
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new OidcError('AUTH_TOKEN_INVALID', 'Malformed ID token');
    }

    let header: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()) as Record<string, unknown>;
    } catch {
      throw new OidcError('AUTH_TOKEN_INVALID', 'Cannot parse ID token header');
    }

    const kid = header['kid'] as string | undefined;

    // Negative-cache guard: if this kid was already unknown, skip re-fetch
    if (kid && this.negativeKidCache.has(kid)) {
      throw new OidcError('AUTH_TOKEN_INVALID', `Unknown key id: ${kid}`);
    }

    let matchingKey = jwks.find((k) => !kid || (k as Record<string, unknown>)['kid'] === kid);

    if (!matchingKey && kid) {
      // Refresh JWKS once for unknown kid (key rotation)
      this.jwksFetchedAt = 0;
      const freshJwks = await this.getJwks();
      matchingKey = freshJwks.find((k) => (k as Record<string, unknown>)['kid'] === kid);
      if (!matchingKey) {
        this.negativeKidCache.add(kid);
        throw new OidcError('AUTH_TOKEN_INVALID', `Key not found after refresh: ${kid}`);
      }
    }

    if (!matchingKey) {
      throw new OidcError('AUTH_TOKEN_INVALID', 'No matching JWKS key found');
    }

    let cryptoKey;
    try {
      cryptoKey = await importJWK(matchingKey as Parameters<typeof importJWK>[0]);
    } catch (e) {
      throw new OidcError('AUTH_TOKEN_INVALID', 'Failed to import JWKS key', e);
    }

    try {
      const { payload } = await jwtVerify(idToken, cryptoKey, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
        clockTolerance: this.config.clockSkewSeconds,
      });

      const claims = payload as IdTokenClaims;

      // Validate nonce
      if (!claims.nonce || claims.nonce !== expectedNonce) {
        throw new OidcError('AUTH_NONCE_MISMATCH', 'ID token nonce mismatch');
      }
      if (!claims.sub) {
        throw new OidcError('AUTH_TOKEN_INVALID', 'ID token missing sub claim');
      }
      if (!claims.email) {
        throw new OidcError('AUTH_TOKEN_INVALID', 'ID token missing email claim');
      }
      if (claims.email_verified !== true) {
        throw new OidcError('AUTH_EMAIL_UNVERIFIED', 'Email address is not verified by the identity provider');
      }

      return claims;
    } catch (err) {
      if (err instanceof OidcError) throw err;
      const msg = (err as Error).message ?? '';
      if (msg.includes('exp')) {
        throw new OidcError('AUTH_TOKEN_EXPIRED', 'ID token expired', err);
      }
      throw new OidcError('AUTH_TOKEN_INVALID', `ID token validation failed: ${msg}`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async discover(): Promise<OidcDiscovery> {
    const now = Date.now();
    if (
      this.cachedDiscovery !== null &&
      now - this.discoveryFetchedAt < this.config.discoveryTtlMs
    ) {
      return this.cachedDiscovery;
    }

    const url = `${this.config.issuer}/.well-known/openid-configuration`;
    let resp: Response;
    try {
      resp = await this.fetchFn(url);
    } catch (e) {
      throw new OidcError('OIDC_PROVIDER_UNREACHABLE', `Cannot reach ${url}`, e);
    }

    if (!resp.ok) {
      throw new OidcError(
        'OIDC_PROVIDER_ERROR',
        `Discovery returned ${resp.status} for ${url}`,
      );
    }

    const doc = (await resp.json()) as OidcDiscovery;
    this.cachedDiscovery = doc;
    this.discoveryFetchedAt = Date.now();
    return doc;
  }

  private async getJwks(): Promise<Record<string, unknown>[]> {
    const now = Date.now();
    if (
      this.cachedJwks !== null &&
      now - this.jwksFetchedAt < this.config.discoveryTtlMs
    ) {
      return this.cachedJwks;
    }

    const discovery = await this.discover();
    let resp: Response;
    try {
      resp = await this.fetchFn(discovery.jwks_uri);
    } catch (e) {
      throw new OidcError('OIDC_PROVIDER_UNREACHABLE', 'Cannot fetch JWKS', e);
    }

    if (!resp.ok) {
      throw new OidcError('OIDC_PROVIDER_ERROR', `JWKS fetch returned ${resp.status}`);
    }

    const jwks = (await resp.json()) as { keys: Record<string, unknown>[] };
    this.cachedJwks = jwks.keys;
    this.jwksFetchedAt = Date.now();
    return this.cachedJwks;
  }

  private async fetchTokens(
    tokenEndpoint: string,
    code: string,
    codeVerifier: string,
  ): Promise<{ id_token: string; access_token?: string }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code,
      code_verifier: codeVerifier,
    });
    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    let resp: Response;
    try {
      resp = await this.fetchFn(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (e) {
      throw new OidcError('OIDC_PROVIDER_UNREACHABLE', 'Token endpoint unreachable', e);
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new OidcError(
        'OIDC_PROVIDER_ERROR',
        `Token endpoint returned ${resp.status}: ${errBody}`,
      );
    }

    return resp.json() as Promise<{ id_token: string; access_token?: string }>;
  }

  private s256Challenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private stateKey(state: string): string {
    return `oidc:state:${state}`;
  }
}

// ---------------------------------------------------------------------------
// In-memory KeyValueStore (for tests and development)
// ---------------------------------------------------------------------------

export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  /** Returns the number of live (non-expired) entries. */
  size(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of this.map.values()) {
      if (now <= entry.expiresAt) count++;
    }
    return count;
  }
}
