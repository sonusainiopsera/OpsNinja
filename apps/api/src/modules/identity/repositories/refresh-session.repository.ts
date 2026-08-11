import { Inject, Injectable } from '@nestjs/common';
import { DB_TOKEN } from '../../../data/db.module';
import { refreshSessions, NewRefreshSession, DB, eq, and, isNull, sql } from '@opsninja/db';

/**
 * Audit repository for refresh sessions.
 *
 * Does NOT extend TenantRepository because auth routes operate outside the
 * tenant transaction context (@NoTenantContext).  All queries include explicit
 * tenantId predicates for app-level isolation.  Redis is the authoritative
 * hot store; Postgres rows exist solely for audit trail and admin operations.
 */
@Injectable()
export class RefreshSessionRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  async create(data: NewRefreshSession): Promise<void> {
    await this.db.insert(refreshSessions).values(data);
  }

  async recordRotation(tenantId: string, sessionId: string): Promise<void> {
    await this.db
      .update(refreshSessions)
      .set({
        rotationCount: sql`${refreshSessions.rotationCount} + 1`,
        lastRotatedAt: new Date(),
      })
      .where(
        and(
          eq(refreshSessions.id, sessionId),
          eq(refreshSessions.tenantId, tenantId),
        ),
      );
  }

  async recordRevocation(tenantId: string, sessionId: string): Promise<void> {
    await this.db
      .update(refreshSessions)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(
        and(
          eq(refreshSessions.id, sessionId),
          eq(refreshSessions.tenantId, tenantId),
        ),
      );
  }

  async findActiveByUser(
    tenantId: string,
    userId: string,
  ): Promise<{ id: string }[]> {
    return this.db
      .select({ id: refreshSessions.id })
      .from(refreshSessions)
      .where(
        and(
          eq(refreshSessions.tenantId, tenantId),
          eq(refreshSessions.userId, userId),
          eq(refreshSessions.isRevoked, false),
          isNull(refreshSessions.revokedAt),
        ),
      );
  }
}
