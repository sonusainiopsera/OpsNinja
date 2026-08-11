import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';
import { ErrorCode } from '../../common/errors/app-errors';
import { RefreshSessionRepository } from './repositories/refresh-session.repository';

export const REFRESH_TTL_S = 8 * 60 * 60; // 8 hours
const GRACE_WINDOW_S = 30;                  // concurrent-tab grace period
const TOKEN_BYTES = 32;                     // 256 bits of entropy
export const REFRESH_COOKIE_NAME = 'opsninja_rt';

// ── Lua script ──────────────────────────────────────────────────────────────
// Atomically validates and rotates the stored hash.
//
// KEYS[1] = session:{tenantId}:{sessionId}
// ARGV[1] = presentedHash  (SHA-256 hex of the refresh token from the cookie)
// ARGV[2] = newHash        (SHA-256 hex of the newly generated replacement token)
// ARGV[3] = graceSecs      (seconds the previous hash remains valid, e.g. "30")
// ARGV[4] = sessionTTL     (new TTL for the key after rotation, e.g. "28800")
// ARGV[5] = now            (Unix timestamp in seconds)
//
// Returns: { status, message, familyId }
//   status  1 = ROTATED          (normal rotation)
//   status  2 = GRACE_ROTATED    (presented previous hash within grace window)
//   status -1 = NOT_FOUND        (key doesn't exist — expired or never created)
//   status -2 = REVOKED          (session explicitly revoked)
//   status -3 = REPLAY_DETECTED  (stale hash outside grace window)
const ROTATE_LUA = `
local key = KEYS[1]
local presentedHash  = ARGV[1]
local newHash        = ARGV[2]
local graceSecs      = tonumber(ARGV[3])
local sessionTTL     = tonumber(ARGV[4])
local now            = tonumber(ARGV[5])

local raw = redis.call('HGETALL', key)
if #raw == 0 then return {-1, 'NOT_FOUND', ''} end

local f = {}
for i = 1, #raw, 2 do f[raw[i]] = raw[i+1] end

if f['revoked'] == '1' then return {-2, 'REVOKED', f['familyId'] or ''} end

local storedHash     = f['hash'] or ''
local prevHash       = f['prevHash'] or ''
local prevExpiry     = tonumber(f['prevHashExpiry'] or '0')
local familyId       = f['familyId'] or ''
local newCount       = tostring(tonumber(f['rotationCount'] or '0') + 1)

if storedHash == presentedHash then
  redis.call('HMSET', key,
    'hash',          newHash,
    'prevHash',      storedHash,
    'prevHashExpiry', tostring(now + graceSecs),
    'rotationCount', newCount)
  redis.call('EXPIRE', key, sessionTTL)
  return {1, 'ROTATED', familyId}
elseif prevHash ~= '' and prevHash == presentedHash and now < prevExpiry then
  redis.call('HSET', key, 'rotationCount', newCount)
  redis.call('EXPIRE', key, sessionTTL)
  return {2, 'GRACE_ROTATED', familyId}
else
  return {-3, 'REPLAY_DETECTED', familyId}
end
`;

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  principalKind: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionToken {
  rawToken: string;   // only ever returned at creation/rotation — never persisted or logged
  sessionId: string;
  tenantId: string;
  expiresAt: Date;
}

type RotateResult = [number, string, string]; // [statusCode, message, familyId]

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private _rotateScriptSha?: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sessionRepo: RefreshSessionRepository,
    private readonly config: ConfigService,
  ) {}

  /** Creates a new session, stores hash in Redis and audit row in Postgres. */
  async createSession(input: CreateSessionInput): Promise<SessionToken> {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
    const hash = this.hashToken(rawToken);
    const expiresAt = new Date(this.now() + REFRESH_TTL_S * 1_000);

    await this.writeToRedis(input.tenantId, sessionId, familyId, hash, input.userId);
    await this.sessionRepo.create({
      id: sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      familyId,
      rotationCount: 0,
      isRevoked: false,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      issuedAt: new Date(this.now()),
      expiresAt,
    });

    this.audit('session.issued', {
      sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      familyId,
    });
    return { rawToken, sessionId, tenantId: input.tenantId, expiresAt };
  }

  /**
   * Rotates the refresh token atomically.  Returns the new raw token and the
   * current org_scope_version for embedding in the minted access token.
   *
   * @throws UnauthorizedException with code AUTH_REFRESH_REUSED when a stale
   *   token is presented — revokes the entire session family as a theft signal.
   * @throws UnauthorizedException with code AUTH_REFRESH_INVALID when not found
   *   or already revoked.
   * @throws ServiceUnavailableException when Redis is unavailable.
   */
  async rotateSession(
    tenantId: string,
    sessionId: string,
    presentedRawToken: string,
  ): Promise<{ newRawToken: string; orgScopeVersion: number }> {
    const newRawToken = randomBytes(TOKEN_BYTES).toString('hex');
    const presentedHash = this.hashToken(presentedRawToken);
    const newHash = this.hashToken(newRawToken);
    const key = this.sessionKey(tenantId, sessionId);
    const now = Math.floor(this.now() / 1_000);

    const result = await this.runRotateLua(
      key, presentedHash, newHash, GRACE_WINDOW_S, REFRESH_TTL_S, now,
    );

    const [status, , familyId] = result;

    if (status === 1 || status === 2) {
      if (status === 1) {
        await this.sessionRepo.recordRotation(tenantId, sessionId).catch(() => {});
      }
      this.audit('session.rotated', { tenantId, sessionId, familyId, graceWindow: status === 2 });
      const orgScopeVersion = await this.getOrgScopeVersion(tenantId);
      return { newRawToken, orgScopeVersion };
    }

    if (status === -1) {
      throw new UnauthorizedException({
        message: 'Refresh token not found or expired.',
        code: ErrorCode.AUTH_REFRESH_INVALID,
      });
    }

    if (status === -2) {
      throw new UnauthorizedException({
        message: 'Session has been revoked.',
        code: ErrorCode.AUTH_REFRESH_INVALID,
      });
    }

    if (status === -3) {
      // Probable token theft: revoke the entire family
      await this.revokeFamilySessions(tenantId, familyId).catch((err) =>
        this.logger.error('Family revocation failed after reuse detection', { err, familyId }),
      );
      this.audit('session.reuse_detected', {
        tenantId,
        sessionId,
        familyId,
        severity: 'HIGH',
      });
      throw new UnauthorizedException({
        message: 'Refresh token reuse detected. All sessions in this family have been revoked.',
        code: ErrorCode.AUTH_REFRESH_REUSED,
      });
    }

    throw new Error(`Unexpected rotation result code: ${status}`);
  }

  /** Revokes a single session (logout). */
  async revokeSession(tenantId: string, sessionId: string): Promise<void> {
    await this.redis.hset(this.sessionKey(tenantId, sessionId), 'revoked', '1');
    await this.sessionRepo.recordRevocation(tenantId, sessionId).catch(() => {});
    this.audit('session.revoked', { tenantId, sessionId });
  }

  /**
   * Revokes all active sessions for a user.  Called on admin-initiated revocation
   * or disable-user flows.  Takes effect immediately for refresh; access tokens
   * expire within their 15-minute TTL.
   */
  async revokeAllSessionsForUser(tenantId: string, userId: string): Promise<number> {
    const sessions = await this.sessionRepo.findActiveByUser(tenantId, userId);
    let count = 0;
    for (const s of sessions) {
      try {
        await this.redis.hset(this.sessionKey(tenantId, s.id), 'revoked', '1');
        await this.sessionRepo.recordRevocation(tenantId, s.id).catch(() => {});
        count++;
      } catch (err) {
        this.logger.warn(`Failed to revoke session ${s.id}`, { err });
      }
    }
    this.audit('session.revoked_all', { tenantId, userId, count });
    return count;
  }

  /**
   * Encodes the session reference into the httpOnly cookie value.
   * Format: base64url( tenantId ":" sessionId ":" rawTokenHex )
   * tenantId and sessionId are UUIDs (hyphens only, no colons); the colon
   * delimiter is unambiguous.
   */
  buildRefreshCookie(token: SessionToken): string {
    return Buffer.from(
      `${token.tenantId}:${token.sessionId}:${token.rawToken}`,
    ).toString('base64url');
  }

  /** Parses and validates the refresh cookie value.  Returns null on any error. */
  parseRefreshCookie(
    cookieValue: string,
  ): { tenantId: string; sessionId: string; rawToken: string } | null {
    try {
      const decoded = Buffer.from(cookieValue, 'base64url').toString('utf8');
      const parts = decoded.split(':');
      // tenantId = parts[0..4] (UUID = 5 groups), sessionId = parts[5..9], token = parts[10]
      // Simpler: UUIDs have exactly 4 hyphens so they never contain ':', split gives 3 results
      if (parts.length !== 3) return null;
      const [tenantId, sessionId, rawToken] = parts;
      if (!tenantId || !sessionId || rawToken?.length !== TOKEN_BYTES * 2) return null;
      return { tenantId, sessionId, rawToken };
    } catch {
      return null;
    }
  }

  /** Constant-time comparison of two SHA-256 hex digests. */
  compareHashesConstantTime(a: string, b: string): boolean {
    try {
      const aBuf = Buffer.from(a, 'hex');
      const bBuf = Buffer.from(b, 'hex');
      if (aBuf.length !== bBuf.length) return false;
      return timingSafeEqual(aBuf, bBuf);
    } catch {
      return false;
    }
  }

  /** Overridable in tests for fake clock injection. */
  protected now(): number {
    return Date.now();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'hex').digest('hex');
  }

  private sessionKey(tenantId: string, sessionId: string): string {
    return `session:${tenantId}:${sessionId}`;
  }

  private familyKey(tenantId: string, familyId: string): string {
    return `session_family:${tenantId}:${familyId}`;
  }

  private async writeToRedis(
    tenantId: string,
    sessionId: string,
    familyId: string,
    hash: string,
    userId: string,
  ): Promise<void> {
    const key = this.sessionKey(tenantId, sessionId);
    try {
      await this.redis.hset(key, {
        hash,
        prevHash: '',
        prevHashExpiry: '0',
        userId,
        familyId,
        rotationCount: '0',
        revoked: '0',
      });
      await this.redis.expire(key, REFRESH_TTL_S);
      // Maintain family index for bulk revocation
      const fk = this.familyKey(tenantId, familyId);
      await this.redis.sadd(fk, sessionId);
      await this.redis.expire(fk, REFRESH_TTL_S);
    } catch (err) {
      this.logger.error('Redis session write failed', { err });
      throw new ServiceUnavailableException({
        message: 'Session store unavailable.',
        code: ErrorCode.AUTH_SESSION_STORE_UNAVAILABLE,
      });
    }
  }

  private async revokeFamilySessions(tenantId: string, familyId: string): Promise<void> {
    if (!familyId) return;
    const sessionIds = await this.redis.smembers(this.familyKey(tenantId, familyId));
    if (sessionIds.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const sid of sessionIds) {
      pipeline.hset(this.sessionKey(tenantId, sid), 'revoked', '1');
    }
    await pipeline.exec();

    for (const sid of sessionIds) {
      await this.sessionRepo.recordRevocation(tenantId, sid).catch(() => {});
    }
    this.audit('session.family_revoked', { tenantId, familyId, count: sessionIds.length });
  }

  private async runRotateLua(
    key: string,
    presentedHash: string,
    newHash: string,
    graceSecs: number,
    sessionTTL: number,
    now: number,
  ): Promise<RotateResult> {
    const args: (string | number)[] = [
      presentedHash, newHash,
      String(graceSecs), String(sessionTTL), String(now),
    ];
    try {
      if (!this._rotateScriptSha) {
        this._rotateScriptSha = (await this.redis.script('LOAD', ROTATE_LUA)) as string;
      }
      try {
        return (await this.redis.evalsha(this._rotateScriptSha, 1, key, ...args)) as RotateResult;
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('NOSCRIPT')) {
          // Script was evicted from Redis; fall through to EVAL
          this._rotateScriptSha = undefined;
        } else {
          throw err;
        }
      }
      return (await this.redis.eval(ROTATE_LUA, 1, key, ...args)) as RotateResult;
    } catch (err) {
      if (
        err instanceof UnauthorizedException
      ) {
        throw err;
      }
      this.logger.error('Redis rotation script failed', { err });
      throw new ServiceUnavailableException({
        message: 'Session store unavailable.',
        code: ErrorCode.AUTH_SESSION_STORE_UNAVAILABLE,
      });
    }
  }

  private async getOrgScopeVersion(tenantId: string): Promise<number> {
    // WO-013 maintains this counter.  Default to 0 until that WO is implemented.
    const val = await this.redis
      .get(`org_scope_version:${tenantId}`)
      .catch(() => null);
    return val ? parseInt(val, 10) : 0;
  }

  /** Structured audit emit — token values and hashes are NEVER included. */
  private audit(event: string, fields: Record<string, unknown>): void {
    this.logger.log({ type: 'audit', event, ...fields });
  }
}
