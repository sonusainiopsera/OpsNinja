/**
 * TokenService — access-token issuance and verification.
 *
 * Design:
 *   - Issues 15-minute JWTs signed with HS256 (shared secret) or RS256 (key pair).
 *   - Multi-key verification: accepts a set of verification keys so signing keys
 *     can rotate without invalidating live tokens until their natural expiry.
 *   - Injectable clock for deterministic testing.
 *   - All required claims (sub, tenant_id, roles, org_scope_version, jti) are
 *     validated on verification; missing claims produce 401.
 *
 * Security invariants:
 *   - The raw secret / private key must never appear in logs or error messages.
 *   - A token missing any required claim is rejected (fail-closed).
 *   - Clock skew tolerance is configurable (default 30 s).
 */

import { SignJWT, jwtVerify, type KeyLike } from 'jose';
import { createHmac, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccessTokenClaims {
  /** OIDC subject (provider user id). */
  sub: string;
  tenant_id: string;
  roles: string[];
  org_scope_version: number;
  jti: string;
  iat: number;
  exp: number;
}

export interface TokenServiceOptions {
  /**
   * Signing key (Uint8Array for HS256, or CryptoKey/KeyLike for RS256/ES256).
   * The first entry is the active signing key; all entries are tried on verify.
   */
  signingKey: KeyLike | Uint8Array;
  /** Additional verification keys for key rotation. */
  verificationKeys?: ReadonlyArray<KeyLike | Uint8Array>;
  /** Algorithm. Defaults to 'HS256'. */
  algorithm?: string;
  /** Issuer claim (iss). */
  issuer?: string;
  /** Audience claim (aud). */
  audience?: string;
  /** Access token TTL in seconds. Default 900 (15 min). */
  accessTokenTtlSeconds?: number;
  /** Clock-skew tolerance in seconds. Default 30. */
  clockSkewSeconds?: number;
  /** Injectable clock for testing. Default: Date.now. */
  clock?: () => number;
}

export type TokenError =
  | 'TOKEN_MISSING'
  | 'TOKEN_MALFORMED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_ISSUER_UNTRUSTED'
  | 'TOKEN_MISSING_CLAIMS';

export class TokenVerificationError extends Error {
  constructor(
    public readonly code: TokenError,
    message: string,
  ) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TokenService {
  private readonly signingKey: KeyLike | Uint8Array;
  private readonly verificationKeys: ReadonlyArray<KeyLike | Uint8Array>;
  private readonly algorithm: string;
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;
  private readonly ttlSeconds: number;
  private readonly clockSkewSeconds: number;
  private readonly clock: () => number;

  constructor(opts: TokenServiceOptions) {
    this.signingKey = opts.signingKey;
    this.verificationKeys = opts.verificationKeys ?? [];
    this.algorithm = opts.algorithm ?? 'HS256';
    this.issuer = opts.issuer;
    this.audience = opts.audience;
    this.ttlSeconds = opts.accessTokenTtlSeconds ?? 900;
    this.clockSkewSeconds = opts.clockSkewSeconds ?? 30;
    this.clock = opts.clock ?? (() => Date.now());
  }

  /**
   * Issues a signed access token with all required claims.
   */
  async issueAccessToken(
    claims: Omit<AccessTokenClaims, 'jti' | 'iat' | 'exp'>,
  ): Promise<string> {
    const nowMs = this.clock();
    const nowSecs = Math.floor(nowMs / 1000);
    const jti = randomBytes(16).toString('hex');

    const builder = new SignJWT({
      sub: claims.sub,
      tenant_id: claims.tenant_id,
      roles: claims.roles,
      org_scope_version: claims.org_scope_version,
      jti,
    })
      .setProtectedHeader({ alg: this.algorithm })
      .setIssuedAt(nowSecs)
      .setExpirationTime(nowSecs + this.ttlSeconds);

    if (this.issuer !== undefined) builder.setIssuer(this.issuer);
    if (this.audience !== undefined) builder.setAudience(this.audience);

    return builder.sign(this.signingKey as KeyLike);
  }

  /**
   * Verifies a token and returns its claims.
   *
   * Tries all keys (signing + rotation set) before failing.
   *
   * @throws TokenVerificationError with a stable code on any failure.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    if (!token) {
      throw new TokenVerificationError('TOKEN_MISSING', 'Access token is missing');
    }

    const keysToTry: ReadonlyArray<KeyLike | Uint8Array> = [
      this.signingKey,
      ...this.verificationKeys,
    ];

    let lastError: Error | undefined;

    for (const key of keysToTry) {
      try {
        const { payload } = await jwtVerify(token, key as KeyLike, {
          algorithms: [this.algorithm],
          issuer: this.issuer,
          audience: this.audience,
          clockTolerance: this.clockSkewSeconds,
        });

        const claims = this.extractRequiredClaims(payload);
        return claims;
      } catch (err) {
        lastError = err as Error;
      }
    }

    // Map jose error names to stable codes.
    const code = this.classifyJoseError(lastError!);
    throw new TokenVerificationError(code, lastError!.message);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private extractRequiredClaims(payload: Record<string, unknown>): AccessTokenClaims {
    const required = ['sub', 'tenant_id', 'roles', 'org_scope_version', 'jti', 'iat', 'exp'];
    const missing = required.filter((k) => payload[k] === undefined || payload[k] === null);
    if (missing.length > 0) {
      throw new TokenVerificationError(
        'TOKEN_MISSING_CLAIMS',
        `Token missing required claims: ${missing.join(', ')}`,
      );
    }
    return {
      sub: payload['sub'] as string,
      tenant_id: payload['tenant_id'] as string,
      roles: payload['roles'] as string[],
      org_scope_version: payload['org_scope_version'] as number,
      jti: payload['jti'] as string,
      iat: payload['iat'] as number,
      exp: payload['exp'] as number,
    };
  }

  private classifyJoseError(err: Error): TokenError {
    const name = err.constructor?.name ?? err.name ?? '';
    const msg = err.message ?? '';

    if (name === 'JWTExpired' || msg.includes('exp')) return 'TOKEN_EXPIRED';
    if (name === 'JWTClaimValidationFailed' && msg.includes('iss')) {
      return 'TOKEN_ISSUER_UNTRUSTED';
    }
    if (
      name === 'JWSInvalid' ||
      name === 'JWSSignatureVerificationFailed' ||
      name === 'JWTMalformed'
    ) {
      return 'TOKEN_MALFORMED';
    }
    return 'TOKEN_MALFORMED';
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Creates an HS256 TokenService from a plain string secret.
 * Use for development / testing. In production prefer RS256.
 */
export function createHs256TokenService(
  secret: string,
  opts?: Partial<TokenServiceOptions>,
): TokenService {
  const key = new TextEncoder().encode(secret);
  return new TokenService({ signingKey: key, algorithm: 'HS256', ...opts });
}

/**
 * Derives a stable HS256 signing key from an environment variable.
 * Hashes the secret to produce a 32-byte key regardless of input length.
 */
export function deriveSecretKey(rawSecret: string): Uint8Array {
  return Buffer.from(
    createHmac('sha256', 'opsninja-key-derive').update(rawSecret).digest(),
  );
}
