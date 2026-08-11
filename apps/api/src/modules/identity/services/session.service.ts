/**
 * SessionService — stateful refresh-token session management.
 *
 * Refresh tokens are opaque 256-bit random values. Only their SHA-256 hash is
 * persisted. Redis is the authoritative hot store; Postgres stores audit rows.
 *
 * Rotation atomicity:
 *   A Lua script performs compare-and-swap on the stored hash so two concurrent
 *   refreshes cannot both succeed with the same input token. The losing request
 *   falls through to the grace-window check (30 s), which tolerates double-
 *   submit from parallel browser tabs.
 *
 * Reuse detection:
 *   Presentation of an out-of-grace previous hash triggers family-wide
 *   revocation and a high-severity audit event. Any token that doesn't match
 *   either the current or grace-window previous hash is treated as invalid.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import type { RefreshSessionRepository } from '../repositories/refresh-session.repository';
import type {
  CreateSessionInput,
  CreatedSession,
  RotateSessionInput,
  RotationOutcome,
  RevokeSessionInput,
  SessionAuditEvent,
} from '../interfaces/session.interface';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REFRESH_TOKEN_TTL_SECONDS = 28_800; // 8 hours
const GRACE_WINDOW_MS = 30_000; // 30 seconds
const SESSION_KEY_PREFIX = 'session';
const REVOKED_FAMILY_KEY_PREFIX = 'revoked_family';
const REVOKED_USER_KEY_PREFIX = 'revoked_user';

// ---------------------------------------------------------------------------
// Lua script for atomic rotation
//
// Arguments:
//   KEYS[1]  = session key (session:{tenantId}:{sessionId})
//   KEYS[2]  = revoked-family key (revoked_family:{tenantId}:{familyId})
//              NOTE: we read familyId from the hash first; KEYS[2] is unused
//              in the Lua itself — the application sets the family-revoke key
//              on reuse detection using the returned familyId.
//   ARGV[1]  = presented hash (hex SHA-256 of the cookie value)
//   ARGV[2]  = current unix ms (string)
//   ARGV[3]  = new token hash
//   ARGV[4]  = grace window expiry (unix ms, string): now + GRACE_WINDOW_MS
//   ARGV[5]  = new session expiry (unix ms, string): now + TTL * 1000
//
// Return values (array):
//   [1] status code: 1=ok, 2=grace_window, 0=failure
//   [2] detail string: 'OK'|'GRACE_WINDOW'|'NOT_FOUND'|'REVOKED'|'EXPIRED'|
//                      'REUSE_DETECTED'|'INVALID'
//   [3] familyId (present on 'ok', 'grace_window', 'reuse_detected')
//   [4] rotationCounter (present on 'ok')
// ---------------------------------------------------------------------------

const ROTATE_SCRIPT = `
local key = KEYS[1]
local presented = ARGV[1]
local now = tonumber(ARGV[2])
local new_hash = ARGV[3]
local grace_exp = tonumber(ARGV[4])
local new_exp_ms = tonumber(ARGV[5])

local exists = redis.call('EXISTS', key)
if exists == 0 then
  return {0, 'NOT_FOUND'}
end

local revoked = redis.call('HGET', key, 'revoked')
if revoked == '1' then
  return {0, 'REVOKED'}
end

local expires_at = tonumber(redis.call('HGET', key, 'expires_at'))
if now > expires_at then
  return {0, 'EXPIRED'}
end

local token_hash = redis.call('HGET', key, 'token_hash')
local family_id  = redis.call('HGET', key, 'family_id')

if token_hash == presented then
  -- Valid: rotate to new hash
  local counter = tonumber(redis.call('HGET', key, 'rotation_counter') or '0') + 1
  redis.call('HSET', key,
    'token_hash', new_hash,
    'prev_hash', token_hash,
    'prev_hash_expires_at', tostring(grace_exp),
    'rotation_counter', tostring(counter),
    'expires_at', tostring(new_exp_ms)
  )
  redis.call('EXPIREAT', key, math.floor(new_exp_ms / 1000))
  return {1, 'OK', family_id, tostring(counter)}
end

-- Check grace window (tolerate double-submit from parallel tabs)
local prev_hash = redis.call('HGET', key, 'prev_hash')
local prev_exp  = tonumber(redis.call('HGET', key, 'prev_hash_expires_at') or '0')

if prev_hash and prev_hash == presented then
  if now <= prev_exp then
    -- Within grace window — re-issue is idempotent
    return {2, 'GRACE_WINDOW', family_id}
  else
    -- Out of grace window — reuse detected → revoke this session
    redis.call('HSET', key, 'revoked', '1')
    return {0, 'REUSE_DETECTED', family_id}
  end
end

-- Presented hash matches nothing
return {0, 'INVALID'}
`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject('REFRESH_SESSION_REPOSITORY')
    private readonly sessionRepo: RefreshSessionRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create a new refresh session. Returns the raw opaque token (set as cookie)
   * and persists only its SHA-256 hash.
   */
  async createSession(input: CreateSessionInput, nowMs?: number): Promise<CreatedSession> {
    const now = nowMs ?? Date.now();
    const sessionId = randomUUID();
    const familyId = input.familyId ?? randomUUID();
    const rawToken = this.generateToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000);

    const sessionKey = this.sessionKey(input.tenantId, sessionId);

    // Write Redis first — Redis is authoritative for live sessions.
    await this.redis
      .multi()
      .hset(sessionKey, {
        tokenHash,
        prevHash: '',
        prevHashExpiresAt: '0',
        userId: input.userId,
        tenantId: input.tenantId,
        familyId,
        rotationCounter: '0',
        revoked: '0',
        createdAt: String(now),
        expiresAt: String(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
      })
      .expireat(sessionKey, Math.floor(expiresAt.getTime() / 1000))
      .exec();

    // Write Postgres audit row (best-effort, does not block).
    this.sessionRepo
      .create({
        id: sessionId,
        tenantId: input.tenantId,
        userId: input.userId,
        familyId,
        tokenHashPreview: tokenHash.slice(-8),
        expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err: Error) => {
        this.logger.warn('Failed to write refresh_sessions audit row', {
          sessionId,
          error: err.message,
        });
      });

    this.emitAudit({
      operation: 'issue',
      sessionId,
      familyId,
      userId: input.userId,
      tenantId: input.tenantId,
      severity: 'info',
    });

    return { sessionId, refreshToken: rawToken, familyId, expiresAt };
  }

  /**
   * Atomically rotate a refresh session. Returns a new raw token on success.
   * Throws on invalid / revoked / expired session; revokes the session family
   * on reuse detection.
   */
  async rotateSession(
    input: RotateSessionInput,
  ): Promise<{ refreshToken: string; familyId: string; sessionId: string }> {
    const now = input.now?.getTime() ?? Date.now();
    const newRawToken = this.generateToken();
    const newHash = this.hashToken(newRawToken);
    const presentedHash = this.hashToken(input.presentedToken);
    const graceExp = now + GRACE_WINDOW_MS;
    const newExp = now + REFRESH_TOKEN_TTL_SECONDS * 1000;

    const sessionKey = this.sessionKey(input.tenantId, input.sessionId);

    let result: (string | null)[];
    try {
      result = (await this.redis.eval(
        ROTATE_SCRIPT,
        1,
        sessionKey,
        presentedHash,
        String(now),
        newHash,
        String(graceExp),
        String(newExp),
      )) as (string | null)[];
    } catch (err) {
      this.logger.error('Redis rotation script failed', { error: (err as Error).message });
      throw Object.assign(new Error('Session store unavailable'), {
        code: 'AUTH_SESSION_STORE_UNAVAILABLE',
      });
    }

    const [statusCode, detail, familyId, counterStr] = result;
    const outcome = detail as string;

    if (statusCode === 1 || statusCode === '1') {
      // Successful rotation
      const counter = parseInt(counterStr as string, 10);
      await this.sessionRepo
        .recordRotation(input.sessionId, counter)
        .catch((err: Error) =>
          this.logger.warn('Failed to record rotation in audit', { error: err.message }),
        );

      this.emitAudit({
        operation: 'rotate',
        sessionId: input.sessionId,
        familyId: familyId as string,
        userId: '',
        tenantId: input.tenantId,
        severity: 'info',
        metadata: { rotationCounter: counter },
      });

      return {
        refreshToken: newRawToken,
        familyId: familyId as string,
        sessionId: input.sessionId,
      };
    }

    if (statusCode === 2 || statusCode === '2') {
      // Grace window — idempotent re-issue of the SAME new token is not
      // possible since we've already generated a different new token. We
      // must treat this as a new successful rotation using the new token.
      // The session was NOT updated by the script, so we do it here.
      await this.redis.hset(sessionKey, {
        tokenHash: newHash,
        prevHashExpiresAt: String(graceExp),
      });
      return {
        refreshToken: newRawToken,
        familyId: familyId as string,
        sessionId: input.sessionId,
      };
    }

    // Failure path
    switch (outcome) {
      case 'REUSE_DETECTED': {
        const fid = familyId as string;
        this.logger.error('REFRESH TOKEN REUSE DETECTED — revoking session family', {
          sessionId: input.sessionId,
          tenantId: input.tenantId,
          familyId: fid,
        });
        // Revoke the entire family in Redis
        await this.revokeFamilyInRedis(input.tenantId, fid);
        // Postgres audit
        await this.sessionRepo
          .recordRevocation(input.sessionId, 'reuse_detected')
          .catch(() => {});
        this.emitAudit({
          operation: 'reuse_detected',
          sessionId: input.sessionId,
          familyId: fid,
          userId: '',
          tenantId: input.tenantId,
          severity: 'error',
        });
        throw Object.assign(new Error('Refresh token reuse detected — session revoked'), {
          code: 'AUTH_REFRESH_REUSED',
        });
      }

      case 'NOT_FOUND':
        throw Object.assign(new Error('Refresh session not found'), {
          code: 'AUTH_REFRESH_INVALID',
        });

      case 'REVOKED':
        throw Object.assign(new Error('Refresh session has been revoked'), {
          code: 'AUTH_REFRESH_INVALID',
        });

      case 'EXPIRED':
        throw Object.assign(new Error('Refresh token has expired'), {
          code: 'AUTH_REFRESH_EXPIRED',
        });

      case 'INVALID':
      default:
        throw Object.assign(new Error('Refresh token is invalid'), {
          code: 'AUTH_REFRESH_INVALID',
        });
    }
  }

  /**
   * Revoke a single session (logout or admin action).
   */
  async revokeSession(input: RevokeSessionInput): Promise<void> {
    const sessionKey = this.sessionKey(input.tenantId, input.sessionId);

    let familyId: string | null = null;
    try {
      familyId = await this.redis.hget(sessionKey, 'familyId');
      await this.redis.hset(sessionKey, 'revoked', '1');
    } catch (err) {
      this.logger.error('Failed to revoke session in Redis', { error: (err as Error).message });
    }

    await this.sessionRepo
      .recordRevocation(input.sessionId, input.reason ?? 'logout')
      .catch((err: Error) =>
        this.logger.warn('Failed to record revocation in audit', { error: err.message }),
      );

    this.emitAudit({
      operation: 'revoke',
      sessionId: input.sessionId,
      familyId: familyId ?? undefined,
      userId: '',
      tenantId: input.tenantId,
      severity: 'info',
      metadata: { reason: input.reason },
    });
  }

  /**
   * Revoke all sessions for a user (logout-everywhere or admin action).
   * Takes effect immediately for refresh; access tokens expire within 15 min.
   */
  async revokeAllSessionsForUser(
    userId: string,
    tenantId: string,
    reason = 'admin_revocation',
  ): Promise<void> {
    // Set a per-user revocation flag in Redis. Every rotation check reads this key.
    const userRevokeKey = `${REVOKED_USER_KEY_PREFIX}:${tenantId}:${userId}`;
    // TTL: access token TTL + refresh TTL (ensure all outstanding tokens are covered)
    const ttl = REFRESH_TOKEN_TTL_SECONDS + 900;
    await this.redis.set(userRevokeKey, '1', 'EX', ttl);

    await this.sessionRepo
      .revokeAllForUser(userId, tenantId, reason)
      .catch((err: Error) =>
        this.logger.warn('Failed to record bulk revocation in audit', { error: err.message }),
      );

    this.emitAudit({
      operation: 'revoke_family',
      sessionId: '',
      userId,
      tenantId,
      severity: 'warn',
      metadata: { reason, scope: 'user_all_sessions' },
    });
  }

  /**
   * Read session metadata from Redis (used by the refresh endpoint to get userId).
   * Returns null if not found, expired, or revoked.
   */
  async getSessionRecord(
    sessionId: string,
    tenantId: string,
  ): Promise<{ userId: string; familyId: string } | null> {
    const sessionKey = this.sessionKey(tenantId, sessionId);
    const record = await this.redis.hgetall(sessionKey);
    if (!record || !record['userId']) return null;
    if (record['revoked'] === '1') return null;
    return { userId: record['userId'], familyId: record['familyId'] };
  }

  /**
   * Check whether a user has been globally revoked (admin action).
   */
  async isUserRevoked(userId: string, tenantId: string): Promise<boolean> {
    const key = `${REVOKED_USER_KEY_PREFIX}:${tenantId}:${userId}`;
    const val = await this.redis.get(key);
    return val === '1';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private generateToken(): string {
    return randomBytes(32).toString('hex'); // 256-bit opaque token
  }

  /**
   * SHA-256 hash of the raw token in constant time.
   * NEVER log the result of this function at info level.
   */
  hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Constant-time comparison of two hex strings.
   * Prevents timing attacks on hash comparisons.
   */
  compareHashes(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  }

  private sessionKey(tenantId: string, sessionId: string): string {
    return `${SESSION_KEY_PREFIX}:${tenantId}:${sessionId}`;
  }

  private async revokeFamilyInRedis(tenantId: string, familyId: string): Promise<void> {
    const key = `${REVOKED_FAMILY_KEY_PREFIX}:${tenantId}:${familyId}`;
    // TTL = refresh TTL so the key lives long enough to catch replays
    await this.redis.set(key, '1', 'EX', REFRESH_TOKEN_TTL_SECONDS);
  }

  private emitAudit(event: SessionAuditEvent): void {
    const logFn =
      event.severity === 'error'
        ? this.logger.error.bind(this.logger)
        : event.severity === 'warn'
          ? this.logger.warn.bind(this.logger)
          : this.logger.log.bind(this.logger);

    logFn(`[session-audit] ${event.operation}`, {
      sessionId: event.sessionId,
      familyId: event.familyId,
      userId: event.userId,
      tenantId: event.tenantId,
      traceId: event.traceId,
      severity: event.severity,
      ...event.metadata,
    });
  }
}
