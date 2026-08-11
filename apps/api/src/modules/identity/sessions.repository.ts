/**
 * SessionsRepository — low-level DB operations for refresh_sessions.
 *
 * All methods accept a postgres `Sql` client (or transaction handle).
 * The caller is responsible for setting app.current_tenant via SET LOCAL
 * before calling — RLS enforces tenant isolation at the DB layer.
 *
 * Methods are intentionally thin; business logic lives in SessionService.
 */

import type { Sql } from 'postgres';

export interface SessionRecord {
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

export class SessionsRepository {
  async findByTokenHash(sql: Sql, tokenHash: string): Promise<SessionRecord | null> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT tenant_id, id, user_id, family_id, token_hash,
             issued_at, expires_at, rotated_at, revoked_at,
             user_agent_hash, ip_hash
      FROM   refresh_sessions
      WHERE  token_hash = $1
      LIMIT  1
    `, [tokenHash]);

    if (rows.length === 0) return null;
    return mapRow(rows[0]!);
  }

  async findByTokenHashForUpdate(sql: Sql, tokenHash: string): Promise<SessionRecord | null> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT tenant_id, id, user_id, family_id, token_hash,
             issued_at, expires_at, rotated_at, revoked_at,
             user_agent_hash, ip_hash
      FROM   refresh_sessions
      WHERE  token_hash = $1
      FOR    UPDATE
      LIMIT  1
    `, [tokenHash]);

    if (rows.length === 0) return null;
    return mapRow(rows[0]!);
  }

  async insert(
    sql: Sql,
    params: {
      tenantId: string;
      id: string;
      userId: string;
      familyId: string;
      tokenHash: string;
      issuedAt: Date;
      expiresAt: Date;
      userAgentHash?: string | null;
      ipHash?: string | null;
    },
  ): Promise<void> {
    await sql.unsafe(`
      INSERT INTO refresh_sessions
        (tenant_id, id, user_id, family_id, token_hash,
         issued_at, expires_at, user_agent_hash, ip_hash)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
         $6::timestamptz, $7::timestamptz, $8, $9)
    `, [
      params.tenantId,
      params.id,
      params.userId,
      params.familyId,
      params.tokenHash,
      params.issuedAt.toISOString(),
      params.expiresAt.toISOString(),
      params.userAgentHash ?? null,
      params.ipHash ?? null,
    ]);
  }

  async markRotated(sql: Sql, tenantId: string, id: string, rotatedAt: Date): Promise<void> {
    await sql.unsafe(`
      UPDATE refresh_sessions
      SET    rotated_at = $1::timestamptz
      WHERE  tenant_id  = $2::uuid
        AND  id         = $3::uuid
    `, [rotatedAt.toISOString(), tenantId, id]);
  }

  async markRevoked(sql: Sql, tenantId: string, id: string, revokedAt: Date): Promise<void> {
    await sql.unsafe(`
      UPDATE refresh_sessions
      SET    revoked_at = $1::timestamptz
      WHERE  tenant_id  = $2::uuid
        AND  id         = $3::uuid
        AND  revoked_at IS NULL
    `, [revokedAt.toISOString(), tenantId, id]);
  }

  async revokeFamilyById(
    sql: Sql,
    tenantId: string,
    familyId: string,
    revokedAt: Date,
  ): Promise<number> {
    const result = await sql.unsafe(`
      UPDATE refresh_sessions
      SET    revoked_at = $1::timestamptz
      WHERE  tenant_id  = $2::uuid
        AND  family_id  = $3::uuid
        AND  revoked_at IS NULL
    `, [revokedAt.toISOString(), tenantId, familyId]);
    return result.count;
  }

  async revokeAllForUser(
    sql: Sql,
    tenantId: string,
    userId: string,
    revokedAt: Date,
  ): Promise<number> {
    const result = await sql.unsafe(`
      UPDATE refresh_sessions
      SET    revoked_at = $1::timestamptz
      WHERE  tenant_id  = $2::uuid
        AND  user_id    = $3::uuid
        AND  revoked_at IS NULL
    `, [revokedAt.toISOString(), tenantId, userId]);
    return result.count;
  }

  async countActive(sql: Sql, tenantId: string, userId: string, now: Date): Promise<number> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT COUNT(*) AS n
      FROM   refresh_sessions
      WHERE  tenant_id  = $1::uuid
        AND  user_id    = $2::uuid
        AND  revoked_at IS NULL
        AND  rotated_at IS NULL
        AND  expires_at > $3::timestamptz
    `, [tenantId, userId, now.toISOString()]);
    return Number((rows[0] as Record<string, unknown>)['n'] ?? 0);
  }
}

function mapRow(row: Record<string, unknown>): SessionRecord {
  return {
    tenantId:     row['tenant_id'] as string,
    id:           row['id'] as string,
    userId:       row['user_id'] as string,
    familyId:     row['family_id'] as string,
    tokenHash:    row['token_hash'] as string,
    issuedAt:     new Date(row['issued_at'] as string),
    expiresAt:    new Date(row['expires_at'] as string),
    rotatedAt:    row['rotated_at'] ? new Date(row['rotated_at'] as string) : null,
    revokedAt:    row['revoked_at'] ? new Date(row['revoked_at'] as string) : null,
    userAgentHash: (row['user_agent_hash'] as string | null) ?? null,
    ipHash:       (row['ip_hash'] as string | null) ?? null,
  };
}
