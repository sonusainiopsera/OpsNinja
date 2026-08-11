/**
 * Typed interfaces for JWT access token claims.
 *
 * Claim shape is fixed across all token versions — any change must be
 * backwards-compatible until all outstanding tokens expire (15 minutes).
 */

export type UserType = 'staff' | 'portal' | 'machine';

/**
 * Claims embedded in every access token. All fields are required so that
 * consumers (realtime gateway, workers) can rely on their presence without
 * null-checks.
 */
export interface AccessTokenClaims {
  /** Registered: subject — user UUID. */
  sub: string;
  /** OpsNinja: tenant UUID. */
  tenant_id: string;
  /** OpsNinja: RBAC role list from the JWT. */
  roles: string[];
  /** OpsNinja: monotonic org-scope version counter from Redis. */
  org_scope_version: number;
  /** OpsNinja: principal population. */
  user_type: UserType;
  /**
   * OpsNinja: bound organisation UUID — present only on portal tokens.
   * Portal users are linked to exactly one organisation at token mint time.
   */
  bound_org_id?: string;
  /** Registered: JWT ID — unique per token, used for audit. */
  jti: string;
  /** Registered: issued-at (unix seconds). */
  iat: number;
  /** Registered: expiry (unix seconds). */
  exp: number;
  /** Registered: issuer. */
  iss: string;
  /** Registered: audience. */
  aud: string | string[];
}

/**
 * Input to TokenService.mintAccessToken — the caller supplies the business
 * fields; the service adds iat, exp, jti.
 */
export interface MintTokenInput {
  sub: string;
  tenantId: string;
  roles: string[];
  orgScopeVersion: number;
  userType: UserType;
  /** Required when userType is 'portal'; the organisation the user is bound to. */
  boundOrgId?: string;
}

/**
 * Result of a successful token mint.
 */
export interface IssuedAccessToken {
  accessToken: string;
  expiresIn: number;  // seconds (always 900)
  expiresAt: Date;
  jti: string;
}

/**
 * The signing key descriptor. OpsNinja uses asymmetric RS256 so that
 * workers and the realtime gateway can verify tokens using only the
 * public JWKS endpoint without calling the identity service.
 */
export interface SigningKey {
  /** Key ID used in the JWT `kid` header. */
  kid: string;
  /** PEM-encoded RSA private key (for signing — never leaves the identity service). */
  privateKeyPem: string;
  /** PEM-encoded RSA public key (for public JWKS). */
  publicKeyPem: string;
}

/**
 * Public JSON Web Key Set response body.
 */
export interface JsonWebKeySet {
  keys: JsonWebKey[];
}
