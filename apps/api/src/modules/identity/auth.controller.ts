/**
 * AuthController — HTTP handler logic for OIDC authentication flows.
 *
 * This controller is framework-agnostic: it accepts a plain AuthRequest
 * object and returns an AuthResponse. Adapters for NestJS, Fastify, or
 * raw http.createServer can wrap these methods without changing the logic.
 *
 * Endpoints:
 *   GET  /api/v1/auth/login    → 302 to OIDC provider
 *   POST /api/v1/auth/callback → exchange code, issue tokens
 *   POST /api/v1/auth/refresh  → rotate refresh token
 *   POST /api/v1/auth/logout   → revoke session + clear cookie
 *
 * API contracts (from WO-005 spec):
 *   - callback returns { access_token, token_type: 'bearer', expires_in: 900 }
 *     + Set-Cookie: opsninja_rt=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth
 *   - refresh returns the same shape
 *   - logout returns 204, clears the cookie
 *   - All errors: { error: '<CODE>', message: '<human>' }
 *
 * Security invariants:
 *   - Cookie is httpOnly, Secure, SameSite=Strict, path-scoped to /api/v1/auth.
 *   - Raw token values and PKCE verifiers must never appear in logs or responses.
 *   - RLS: all DB ops run with SET LOCAL app.current_tenant = <tenantId>.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import type { TokenService } from './token.service.js';
import type { SessionService } from './session.service.js';
import type { OidcService } from './oidc.service.js';
import type { UsersRepository } from './users.repository.js';
import { OidcError } from './oidc.service.js';
import { hashToken } from './session.service.js';

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

export interface AuthRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  cookies: Record<string, string | undefined>;
  ip: string;
}

export interface AuthResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

// ---------------------------------------------------------------------------
// Throttle store interface
// ---------------------------------------------------------------------------

export interface ThrottleStore {
  /** Increments a counter and returns the new count. */
  increment(key: string, windowSeconds: number): Promise<number>;
  /** Sets a lockout key with a TTL. */
  setLockout(key: string, ttlSeconds: number): Promise<void>;
  /** Checks whether a lockout key exists. */
  isLockedOut(key: string): Promise<boolean>;
  /** Returns the remaining TTL in seconds for a lockout key. */
  lockoutTtlSeconds(key: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export interface AuthControllerOptions {
  sql: Sql;
  tokenService: TokenService;
  sessionService: SessionService;
  oidcService: OidcService;
  usersRepository: UsersRepository;
  throttleStore: ThrottleStore;
  /** Cookie name. Default: opsninja_rt */
  cookieName?: string;
  /** Refresh token TTL in seconds. Default 28800 (8 hours). */
  refreshTokenTtlSeconds?: number;
  /** Max failed attempts per email before lockout. Default 5. */
  maxFailedAttempts?: number;
  /** Lockout duration in seconds. Default 900 (15 min). */
  lockoutSeconds?: number;
  /** Whether to set Secure flag on cookies. Defaults to true. */
  secureCookies?: boolean;
  /** Injectable clock for testing. */
  clock?: () => Date;
}

export class AuthController {
  private readonly sql: Sql;
  private readonly tokenService: TokenService;
  private readonly sessionService: SessionService;
  private readonly oidcService: OidcService;
  private readonly usersRepo: UsersRepository;
  private readonly throttleStore: ThrottleStore;
  private readonly cookieName: string;
  private readonly refreshTtlSeconds: number;
  private readonly maxFailed: number;
  private readonly lockoutSeconds: number;
  private readonly secureCookies: boolean;
  private readonly clock: () => Date;

  constructor(opts: AuthControllerOptions) {
    this.sql = opts.sql;
    this.tokenService = opts.tokenService;
    this.sessionService = opts.sessionService;
    this.oidcService = opts.oidcService;
    this.usersRepo = opts.usersRepository;
    this.throttleStore = opts.throttleStore;
    this.cookieName = opts.cookieName ?? 'opsninja_rt';
    this.refreshTtlSeconds = opts.refreshTokenTtlSeconds ?? 8 * 60 * 60;
    this.maxFailed = opts.maxFailedAttempts ?? 5;
    this.lockoutSeconds = opts.lockoutSeconds ?? 15 * 60;
    this.secureCookies = opts.secureCookies ?? true;
    this.clock = opts.clock ?? (() => new Date());
  }

  // -------------------------------------------------------------------------
  // GET /api/v1/auth/login
  // -------------------------------------------------------------------------

  async handleLogin(req: AuthRequest): Promise<AuthResponse> {
    const state = randomBytes(16).toString('base64url');
    const redirectTo = req.query['redirect_to'];

    try {
      const authUrl = await this.oidcService.buildAuthorizationUrl(state, redirectTo);
      return {
        status: 302,
        headers: { Location: authUrl },
      };
    } catch (e) {
      return this.oidcError(e, 'OIDC_PROVIDER_UNAVAILABLE', 'OIDC provider unreachable', 503);
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/auth/callback
  // -------------------------------------------------------------------------

  async handleCallback(req: AuthRequest): Promise<AuthResponse> {
    const body = req.body as Record<string, unknown> | null | undefined;
    const code  = (body?.['code']  ?? req.query['code']) as string | undefined;
    const state = (body?.['state'] ?? req.query['state']) as string | undefined;

    if (!code || !state) {
      return this.errorResponse(400, 'AUTH_INVALID_REQUEST', 'Missing code or state');
    }

    const ipHash = this.hashField(req.ip);

    // Check IP-level throttle
    const ipLockKey = `throttle:ip:${ipHash}`;
    if (await this.throttleStore.isLockedOut(ipLockKey)) {
      const ttl = await this.throttleStore.lockoutTtlSeconds(ipLockKey);
      return this.tooManyRequests(ttl);
    }

    let idTokenClaims;
    try {
      idTokenClaims = (await this.oidcService.exchangeCode(code, state)).idTokenClaims;
    } catch (e) {
      if (e instanceof OidcError) {
        if (e.code === 'AUTH_INVALID_STATE') {
          return this.errorResponse(401, 'AUTH_INVALID_STATE', 'Invalid or expired state');
        }
        if (e.code === 'OIDC_PROVIDER_UNREACHABLE' || e.code === 'OIDC_PROVIDER_ERROR') {
          return this.errorResponse(503, 'OIDC_PROVIDER_UNAVAILABLE', 'Provider error');
        }
      }
      return this.errorResponse(401, 'AUTH_CALLBACK_FAILED', 'Authentication failed');
    }

    const email = idTokenClaims.email.toLowerCase().trim();
    const emailHash = this.hashField(email);
    const emailLockKey = `throttle:email:${emailHash}`;

    // Check email-level throttle
    if (await this.throttleStore.isLockedOut(emailLockKey)) {
      const ttl = await this.throttleStore.lockoutTtlSeconds(emailLockKey);
      return this.tooManyRequests(ttl);
    }

    // Resolve tenant from email domain
    const domain = email.split('@')[1] ?? '';
    const tenantMatch = await this.usersRepo.resolveTenantByEmailDomain(this.sql, domain);
    if (!tenantMatch) {
      await this.recordFailedAttempt(emailLockKey, ipLockKey);
      return this.errorResponse(403, 'AUTH_TENANT_UNRESOLVED', 'Email domain not recognised');
    }

    const { tenantId } = tenantMatch;

    // All tenant-scoped DB ops run within a transaction with SET LOCAL tenant
    const result = await this.sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);

      const user = await this.usersRepo.provisionStaff(tx as unknown as Sql, {
        tenantId,
        email: idTokenClaims.email,
        displayName: idTokenClaims.name,
      });

      if (user.status === 'deactivated') {
        return { error: 'USER_DEACTIVATED' as const };
      }

      const roles = await this.usersRepo.findUserRoles(tx as unknown as Sql, tenantId, user.id);
      const orgScopeVersion = await this.usersRepo.getOrgScopeVersion(
        tx as unknown as Sql,
        tenantId,
        user.id,
      );

      const expiresAt = new Date(this.clock().getTime() + this.refreshTtlSeconds * 1000);
      const uaHash = req.headers['user-agent']
        ? this.hashField(Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0]! : req.headers['user-agent'] as string)
        : undefined;

      const session = await this.sessionService.create(tx as unknown as Sql, {
        tenantId,
        userId: user.id,
        expiresAt,
        userAgentHash: uaHash,
        ipHash,
      });

      const accessToken = await this.tokenService.issueAccessToken({
        sub: user.id,
        tenant_id: tenantId,
        roles: roles.map((r) => r.roleName),
        org_scope_version: orgScopeVersion,
      });

      return { user, session, accessToken, roles, orgScopeVersion };
    });

    if ('error' in result) {
      return this.errorResponse(403, result.error, 'Account is deactivated');
    }

    const { session, accessToken } = result;
    return this.successWithCookie(accessToken, session.rawToken, session.expiresAt);
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/auth/refresh
  // -------------------------------------------------------------------------

  async handleRefresh(req: AuthRequest): Promise<AuthResponse> {
    const rawToken = req.cookies[this.cookieName];
    if (!rawToken) {
      return this.errorResponse(401, 'REFRESH_TOKEN_MISSING', 'Refresh cookie not present');
    }

    const ipHash = this.hashField(req.ip);
    const newExpiresAt = new Date(this.clock().getTime() + this.refreshTtlSeconds * 1000);
    const uaHash = req.headers['user-agent']
      ? this.hashField(Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0]! : req.headers['user-agent'] as string)
      : undefined;

    // First find the session to get tenantId (needed for SET LOCAL)
    const tokenHash = hashToken(rawToken);
    const existing = await this.sessionService.findByHash(this.sql, tokenHash);
    if (!existing) {
      return this.errorResponse(401, 'REFRESH_TOKEN_INVALID', 'Refresh token not found');
    }

    const { tenantId } = existing;

    const outcome = await this.sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return this.sessionService.rotate(tx as unknown as Sql, rawToken, newExpiresAt, {
        userAgentHash: uaHash,
        ipHash,
      });
    });

    if (outcome.kind === 'not_found' || outcome.kind === 'expired') {
      return this.errorResponse(401, 'REFRESH_TOKEN_INVALID', 'Refresh token invalid or expired');
    }
    if (outcome.kind === 'revoked') {
      return this.errorResponse(401, 'REFRESH_TOKEN_REVOKED', 'Session was revoked');
    }
    if (outcome.kind === 'reuse_detected') {
      // Entire family revoked — return 401 with high-severity code
      return this.errorResponse(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse detected — session revoked');
    }

    // Issue new access token
    const { newSession } = outcome.result;
    const user = await this.usersRepo.findById(this.sql, tenantId, existing.userId);
    if (!user || user.status === 'deactivated') {
      return this.errorResponse(401, 'USER_DEACTIVATED', 'Account is deactivated');
    }

    const roles = await this.usersRepo.findUserRoles(this.sql, tenantId, user.id);
    const orgScopeVersion = await this.usersRepo.getOrgScopeVersion(this.sql, tenantId, user.id);

    const accessToken = await this.tokenService.issueAccessToken({
      sub: user.id,
      tenant_id: tenantId,
      roles: roles.map((r) => r.roleName),
      org_scope_version: orgScopeVersion,
    });

    return this.successWithCookie(accessToken, newSession.rawToken, newSession.expiresAt);
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/auth/logout
  // -------------------------------------------------------------------------

  async handleLogout(req: AuthRequest): Promise<AuthResponse> {
    const rawToken = req.cookies[this.cookieName];
    if (!rawToken) {
      // Already logged out — idempotent 204
      return { status: 204, headers: { ...this.clearCookieHeader() } };
    }

    const tokenHash = hashToken(rawToken);
    const session = await this.sessionService.findByHash(this.sql, tokenHash);

    if (session) {
      await this.sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL "app.current_tenant" = '${session.tenantId}'`);
        await this.sessionService.revokeSession(
          tx as unknown as Sql,
          session.tenantId,
          session.id,
        );
      });
    }

    return { status: 204, headers: { ...this.clearCookieHeader() } };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private successWithCookie(
    accessToken: string,
    rawRefreshToken: string,
    expiresAt: Date,
  ): AuthResponse {
    const cookieAttrs = [
      `${this.cookieName}=${rawRefreshToken}`,
      'HttpOnly',
      this.secureCookies ? 'Secure' : '',
      'SameSite=Strict',
      'Path=/api/v1/auth',
      `Expires=${expiresAt.toUTCString()}`,
    ].filter(Boolean).join('; ');

    return {
      status: 200,
      headers: { 'Set-Cookie': cookieAttrs },
      body: {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 900,
      },
    };
  }

  private clearCookieHeader(): Record<string, string> {
    const cookieAttrs = [
      `${this.cookieName}=`,
      'HttpOnly',
      this.secureCookies ? 'Secure' : '',
      'SameSite=Strict',
      'Path=/api/v1/auth',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Max-Age=0',
    ].filter(Boolean).join('; ');
    return { 'Set-Cookie': cookieAttrs };
  }

  private errorResponse(
    status: number,
    code: string,
    message: string,
  ): AuthResponse {
    return { status, headers: {}, body: { error: code, message } };
  }

  private tooManyRequests(retryAfterSeconds: number): AuthResponse {
    return {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
      body: { error: 'AUTH_RATE_LIMITED', message: 'Too many attempts. Please wait.' },
    };
  }

  private oidcError(
    e: unknown,
    fallbackCode: string,
    fallbackMsg: string,
    status: number,
  ): AuthResponse {
    if (e instanceof OidcError) {
      return this.errorResponse(status, e.code, e.message);
    }
    return this.errorResponse(status, fallbackCode, fallbackMsg);
  }

  private async recordFailedAttempt(
    emailLockKey: string,
    ipLockKey: string,
  ): Promise<void> {
    const emailCount = await this.throttleStore.increment(emailLockKey, 3600);
    if (emailCount >= this.maxFailed) {
      await this.throttleStore.setLockout(emailLockKey, this.lockoutSeconds);
    }
    const ipCount = await this.throttleStore.increment(ipLockKey, 3600);
    if (ipCount >= this.maxFailed * 3) {
      await this.throttleStore.setLockout(ipLockKey, this.lockoutSeconds);
    }
  }

  private hashField(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

// ---------------------------------------------------------------------------
// In-memory ThrottleStore (for tests)
// ---------------------------------------------------------------------------

export class InMemoryThrottleStore implements ThrottleStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();
  private readonly lockouts = new Map<string, number>();

  async increment(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (!existing || now > existing.expiresAt) {
      this.counters.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return 1;
    }
    existing.count++;
    return existing.count;
  }

  async setLockout(key: string, ttlSeconds: number): Promise<void> {
    this.lockouts.set(key, Date.now() + ttlSeconds * 1000);
  }

  async isLockedOut(key: string): Promise<boolean> {
    const exp = this.lockouts.get(key);
    if (exp === undefined) return false;
    if (Date.now() > exp) {
      this.lockouts.delete(key);
      return false;
    }
    return true;
  }

  async lockoutTtlSeconds(key: string): Promise<number> {
    const exp = this.lockouts.get(key);
    if (exp === undefined) return 0;
    return Math.max(0, Math.ceil((exp - Date.now()) / 1000));
  }

  reset(): void {
    this.counters.clear();
    this.lockouts.clear();
  }
}
