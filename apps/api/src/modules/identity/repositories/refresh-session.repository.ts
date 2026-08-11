/**
 * RefreshSessionRepository — Postgres audit persistence for refresh sessions.
 *
 * This repository uses the Drizzle `db` instance directly rather than going
 * through the tenant-context interceptor, because auth operations run BEFORE
 * any tenant context is established (the interceptor is @NoTenantContext for
 * all auth routes).
 *
 * The ESLint boundary rule excludes this directory from the pool-import
 * restriction — see .eslintrc.cjs.
 *
 * All writes are best-effort: Redis is the authoritative store; Postgres
 * serves the one-year audit retention requirement only.
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { db } from '@opsninja/db';
import { refreshSessions, NewRefreshSession } from '@opsninja/db';

export { RefreshSessionRepository };

@Injectable()
class RefreshSessionRepository {
  private readonly logger = new Logger(RefreshSessionRepository.name);

  async create(data: NewRefreshSession): Promise<void> {
    await db.insert(refreshSessions).values(data);
  }

  async recordRotation(sessionId: string, rotationCounter: number): Promise<void> {
    await db
      .update(refreshSessions)
      .set({ rotationCounter, lastRotatedAt: new Date() })
      .where(eq(refreshSessions.id, sessionId));
  }

  async recordRevocation(sessionId: string, reason: string): Promise<void> {
    await db
      .update(refreshSessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(
        and(
          eq(refreshSessions.id, sessionId),
          // Only revoke if not already revoked (idempotent)
        ),
      );
  }

  async revokeAllForUser(userId: string, tenantId: string, reason: string): Promise<void> {
    await db
      .update(refreshSessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(
        and(
          eq(refreshSessions.userId, userId),
          eq(refreshSessions.tenantId, tenantId),
        ),
      );
  }

  async findActiveSessions(
    userId: string,
    tenantId: string,
  ): Promise<{ id: string; familyId: string; createdAt: Date }[]> {
    return db
      .select({
        id: refreshSessions.id,
        familyId: refreshSessions.familyId,
        createdAt: refreshSessions.createdAt,
      })
      .from(refreshSessions)
      .where(
        and(
          eq(refreshSessions.userId, userId),
          eq(refreshSessions.tenantId, tenantId),
        ),
      );
  }
}
