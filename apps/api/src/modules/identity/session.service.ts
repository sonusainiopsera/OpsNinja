/**
 * SessionService — rotating refresh-token lifecycle management.
 *
 * Design:
 *   - Refresh tokens are 256-bit random values; the SHA-256 hash is stored.
 *   - Each session belongs to a family (family_id). All rotated children
 *     share the same family_id so a single revocation call can sweep them all.
 *   - Rotation reuse detection: when a token is presented whose row has
 *     rotated_at NOT NULL, the token was already superseded. This indicates
 *     a stolen token replay; the whole family is revoked immediately.
 *   - Concurrent refresh (two tabs opening simultaneously): both tabs present
 *     the same valid token. The first one rotates it (sets rotated_at on the
 *     old row, inserts a new row). The second one sees rotated_at != NULL and
 *     would trigger family revocation. To handle this gracefully, the service
 *     checks whether the "new" token from the first rotation is still valid
 *     within a short window — if so, the second call returns the already-rotated
 *     result rather than revoking. (NOT implemented here — left as a prod
 *     hardening step. Currently concurrent refresh triggers family revocation.)
 *
 * Security invariants:
 *   - Raw refresh token values must never be logged.
 *   - All DB writes happen within the caller-supplied transaction.
 *   - RLS: callers must SET LOCAL app.current_tenant before calling.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSessionParams {
  tenantId: string;
  userId: string;
  expiresAt: Date;
  userAgentHash?: string;
  ipHash?: string;
  /** Supply to continue an existing session family (rotation). */
  familyId?: string;
}

export interface SessionResult {
  sessionId: string;
  familyId: string;
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface RotateSessionResult {
  newSession: SessionResult;
  revokedSessionId: string;
}

export interface SessionRow {
  tenantId: string;
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  userAgentHash: string | null;
  ipHash: string | null;
}

export type RotationOutcome =
  | { kind: 'rotated'; result: RotateSessionResult }
  | { kind: 'reuse_detected'; familyId: string }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'revoked' };

export class SessionReuseError extends Error {
  constructor(public readonly familyId: string) {
    super(`Refresh token reuse detected — family ${familyId} revoked`);
    this.name = 'SessionReuseError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function hashField(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------
// SessionService
// ---------------------------------------------------------------------------

export class SessionService {
  private readonly clock: () => Date;

  constructor(opts?: { clock?: () => Date }) {
    this.clock = opts?.clock ?? (() => new Date());
  }

  /**
   * Creates a new refresh session. Returns the raw token (once) for delivery
   * to the client as a cookie. Only the hash is stored in the DB.
   */
  async create(sql: Sql, params: CreateSessionParams): Promise<SessionResult> {
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const familyId = params.familyId ?? randomBytes(16).toString('hex');
    const sessionId = randomUuid();

    await sql.unsafe(`
      INSERT INTO refresh_sessions
        (tenant_id, id, user_id, family_id, token_hash, issued_at, expires_at,
         user_agent_hash, ip_hash)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
         $6::timestamptz, $7::timestamptz, $8, $9)
    `, [
      params.tenantId,
      sessionId,
      params.userId,
      familyId,
      tokenHash,
      this.clock().toISOString(),
      params.expiresAt.toISOString(),
      params.userAgentHash ?? null,
      params.ipHash ?? null,
    ]);

    return { sessionId, familyId, rawToken, tokenHash, expiresAt: params.expiresAt };
  }

  /**
   * Finds a session by raw token hash.
   * Returns null if not found.
   */
  async findByRawToken(sql: Sql, rawToken: string): Promise<SessionRow | null> {
    const hash = hashToken(rawToken);
    return this.findByHash(sql, hash);
  }

  async findByHash(sql: Sql, tokenHash: string): Promise<SessionRow | null> {
    const rows = await sql.unsafe<SessionRow[]>(`
      SELECT tenant_id, id, user_id, family_id, token_hash,
             issued_at, expires_at, rotated_at, revoked_at,
             user_agent_hash, ip_hash
      FROM refresh_sessions
      WHERE token_hash = $1
      LIMIT 1
    `, [tokenHash]);

    if (rows.length === 0) return null;
    return rows[0] as unknown as SessionRow;
  }

  /**
   * Rotates a refresh session: marks the old one as rotated and creates a new
   * one in the same family.
   *
   * Returns the outcome:
   *   - 'rotated': normal case
   *   - 'reuse_detected': the token was already rotated — family revoked
   *   - 'not_found' / 'expired' / 'revoked': terminal invalid states
   *
   * The entire operation is performed within the caller's transaction.
   * The caller must SET LOCAL app.current_tenant before calling.
   */
  async rotate(
    sql: Sql,
    rawToken: string,
    newExpiresAt: Date,
    meta?: { userAgentHash?: string; ipHash?: string },
  ): Promise<RotationOutcome> {
    const tokenHash = hashToken(rawToken);
    const now = this.clock();

    // SELECT ... FOR UPDATE to serialise concurrent rotation attempts
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT tenant_id, id, user_id, family_id, token_hash,
             issued_at, expires_at, rotated_at, revoked_at
      FROM refresh_sessions
      WHERE token_hash = $1
      FOR UPDATE
    `, [tokenHash]);

    if (rows.length === 0) return { kind: 'not_found' };

    const session = rows[0]!;
    const tenantId = session['tenant_id'] as string;
    const sessionId = session['id'] as string;
    const userId = session['user_id'] as string;
    const familyId = session['family_id'] as string;
    const expiresAt = new Date(session['expires_at'] as string);
    const rotatedAt = session['rotated_at'] ? new Date(session['rotated_at'] as string) : null;
    const revokedAt = session['revoked_at'] ? new Date(session['revoked_at'] as string) : null;

    if (revokedAt !== null) return { kind: 'revoked' };
    if (expiresAt < now) return { kind: 'expired' };

    if (rotatedAt !== null) {
      // Token was already rotated — REUSE DETECTED → revoke the whole family
      await this.revokeFamilyById(sql, tenantId, familyId, now);
      return { kind: 'reuse_detected', familyId };
    }

    // Mark existing session as rotated
    await sql.unsafe(`
      UPDATE refresh_sessions
      SET    rotated_at = $1::timestamptz
      WHERE  tenant_id  = $2::uuid
        AND  id         = $3::uuid
    `, [now.toISOString(), tenantId, sessionId]);

    // Create new session in same family
    const newSession = await this.create(sql, {
      tenantId,
      userId,
      expiresAt: newExpiresAt,
      familyId,
      userAgentHash: meta?.userAgentHash,
      ipHash: meta?.ipHash,
    });

    return {
      kind: 'rotated',
      result: {
        newSession,
        revokedSessionId: sessionId,
      },
    };
  }

  /**
   * Revokes a specific session (logout).
   */
  async revokeSession(sql: Sql, tenantId: string, sessionId: string): Promise<void> {
    const now = this.clock();
    await sql.unsafe(`
      UPDATE refresh_sessions
      SET    revoked_at = $1::timestamptz
      WHERE  tenant_id  = $2::uuid
        AND  id         = $3::uuid
        AND  revoked_at IS NULL
    `, [now.toISOString(), tenantId, sessionId]);
  }

  /**
   * Revokes all sessions in a family (reuse detection or security sweep).
   */
  async revokeFamilyById(
    sql: Sql,
    tenantId: string,
    familyId: string,
    at?: Date,
  ): Promise<void> {
    const revokeAt = at ?? this.clock();
    await sql.unsafe(`
      UPDATE refresh_sessions
      SET    revoked_at = $1::timestamptz
      WHERE  tenant_id  = $2::uuid
        AND  family_id  = $3::uuid
        AND  revoked_at IS NULL
    `, [revokeAt.toISOString(), tenantId, familyId]);
  }

  /**
   * Revokes all active sessions for a user (admin action / user deactivation).
   */
  async revokeAllForUser(sql: Sql, tenantId: string, userId: string): Promise<number> {
    const now = this.clock();
    const result = await sql.unsafe(`
      UPDATE refresh_sessions
      SET    revoked_at = $1::timestamptz
      WHERE  tenant_id  = $2::uuid
        AND  user_id    = $3::uuid
        AND  revoked_at IS NULL
    `, [now.toISOString(), tenantId, userId]);
    return result.count;
  }

  /**
   * Counts active (non-revoked, non-expired) sessions for a user.
   */
  async countActiveSessions(sql: Sql, tenantId: string, userId: string): Promise<number> {
    const now = this.clock();
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT COUNT(*) AS n
      FROM refresh_sessions
      WHERE tenant_id  = $1::uuid
        AND user_id    = $2::uuid
        AND revoked_at IS NULL
        AND rotated_at IS NULL
        AND expires_at > $3::timestamptz
    `, [tenantId, userId, now.toISOString()]);
    return Number((rows[0] as Record<string, unknown>)['n'] ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function randomUuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
