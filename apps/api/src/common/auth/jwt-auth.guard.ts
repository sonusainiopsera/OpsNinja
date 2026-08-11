/**
 * JwtAuthGuard — framework-agnostic JWT verification.
 *
 * Verifies the Bearer token from the Authorization header, builds a
 * PrincipalContext for the tenant interceptor, and translates all jose
 * errors into 401 responses with stable machine codes.
 *
 * Optionally consults a RevocationStore so deactivated users lose access
 * before their token's 15-minute expiry.
 *
 * Fail-closed: any unverifiable token returns 401; the guard never fails open.
 */

import type { TokenService, AccessTokenClaims } from '../../modules/identity/token.service.js';
import { TokenVerificationError } from '../../modules/identity/token.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrincipalContext {
  sub: string;
  tenantId: string;
  roles: string[];
  orgScopeVersion: number;
  jti: string;
}

/** Optional revocation signal (e.g. Redis set of revoked JTIs / deactivated user IDs). */
export interface RevocationStore {
  isRevoked(jti: string): Promise<boolean>;
  isUserDeactivated(userId: string, tenantId: string): Promise<boolean>;
}

export interface GuardResult {
  ok: true;
  principal: PrincipalContext;
}

export interface GuardError {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type GuardOutcome = GuardResult | GuardError;

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export class JwtAuthGuard {
  private readonly tokenService: TokenService;
  private readonly revocationStore?: RevocationStore;

  constructor(tokenService: TokenService, revocationStore?: RevocationStore) {
    this.tokenService = tokenService;
    this.revocationStore = revocationStore;
  }

  /**
   * Verifies an incoming request's Authorization header.
   *
   * @param authHeader - Value of the Authorization header (e.g. "Bearer eyJ...")
   */
  async verify(authHeader: string | undefined): Promise<GuardOutcome> {
    if (!authHeader) {
      return this.deny(401, 'TOKEN_MISSING', 'Authorization header required');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return this.deny(401, 'TOKEN_MALFORMED', 'Expected Bearer token');
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.tokenService.verifyAccessToken(token);
    } catch (e) {
      if (e instanceof TokenVerificationError) {
        return this.deny(401, e.code, 'Token verification failed');
      }
      return this.deny(401, 'TOKEN_MALFORMED', 'Token verification failed');
    }

    // Optional: check revocation store
    if (this.revocationStore) {
      const [jtiRevoked, userDeactivated] = await Promise.all([
        this.revocationStore.isRevoked(claims.jti),
        this.revocationStore.isUserDeactivated(claims.sub, claims.tenant_id),
      ]);

      if (jtiRevoked) {
        return this.deny(401, 'TOKEN_REVOKED', 'Token has been revoked');
      }
      if (userDeactivated) {
        return this.deny(401, 'USER_DEACTIVATED', 'User account is deactivated');
      }
    }

    const principal: PrincipalContext = {
      sub: claims.sub,
      tenantId: claims.tenant_id,
      roles: claims.roles,
      orgScopeVersion: claims.org_scope_version,
      jti: claims.jti,
    };

    return { ok: true, principal };
  }

  private deny(status: number, code: string, message: string): GuardError {
    return { ok: false, status, code, message };
  }
}

// ---------------------------------------------------------------------------
// No-op revocation store (for tests without Redis)
// ---------------------------------------------------------------------------

export class NoOpRevocationStore implements RevocationStore {
  async isRevoked(_jti: string): Promise<boolean> { return false; }
  async isUserDeactivated(_userId: string, _tenantId: string): Promise<boolean> { return false; }
}

// ---------------------------------------------------------------------------
// In-memory revocation store (for testing)
// ---------------------------------------------------------------------------

export class InMemoryRevocationStore implements RevocationStore {
  private readonly revokedJtis = new Set<string>();
  private readonly deactivatedUsers = new Set<string>();

  revokeJti(jti: string): void { this.revokedJtis.add(jti); }
  deactivateUser(userId: string, tenantId: string): void {
    this.deactivatedUsers.add(`${tenantId}:${userId}`);
  }

  async isRevoked(jti: string): Promise<boolean> {
    return this.revokedJtis.has(jti);
  }
  async isUserDeactivated(userId: string, tenantId: string): Promise<boolean> {
    return this.deactivatedUsers.has(`${tenantId}:${userId}`);
  }
}
