/**
 * NotificationsRepository
 *
 * Persists notification rows and looks up suppression status.
 * All methods run inside the ambient tenant transaction — the tenant_id is
 * read from PrincipalContext and the transaction handle comes from ALS via
 * this.tx (TenantRepository pattern).
 */

import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';

import {
  notifications,
  notificationSuppressions,
  type NewNotification,
  type NotificationStatus,
  type SuppressionReason,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class NotificationsRepository extends TenantRepository {
  /**
   * Insert a notification row using the idempotency dedupe_key.
   * Returns the notification id, or null if the row already exists (conflict).
   */
  async insertIfNotDuplicate(
    notification: Omit<NewNotification, 'id'>,
  ): Promise<string | null> {
    const inserted = await this.tx
      .insert(notifications)
      .values(notification)
      .onConflictDoNothing({
        target: [notifications.tenantId, notifications.dedupeKey],
      })
      .returning({ id: notifications.id });

    return inserted[0]?.id ?? null;
  }

  /** Update notification status and provider_message_id on successful delivery. */
  async markSent(tenantId: string, id: string, providerMessageId: string): Promise<void> {
    await this.tx
      .update(notifications)
      .set({ status: 'sent', providerMessageId, sentAt: new Date(), attempts: 1 })
      .where(and(eq(notifications.tenantId, tenantId), eq(notifications.id, id)));
  }

  /** Update notification status to suppressed. */
  async markSuppressed(tenantId: string, id: string): Promise<void> {
    await this.tx
      .update(notifications)
      .set({ status: 'suppressed', errorCode: 'SUPPRESSED' })
      .where(and(eq(notifications.tenantId, tenantId), eq(notifications.id, id)));
  }

  /** Update notification status to failed with an error code. */
  async markFailed(
    tenantId: string,
    id: string,
    errorCode: string,
    attempts: number,
  ): Promise<void> {
    await this.tx
      .update(notifications)
      .set({ status: 'failed' as NotificationStatus, errorCode, attempts })
      .where(and(eq(notifications.tenantId, tenantId), eq(notifications.id, id)));
  }

  /** Increment attempts counter (for retryable SES errors). */
  async incrementAttempts(tenantId: string, id: string): Promise<void> {
    const current = await this.tx
      .select({ attempts: notifications.attempts })
      .from(notifications)
      .where(and(eq(notifications.tenantId, tenantId), eq(notifications.id, id)))
      .limit(1);
    const next = (current[0]?.attempts ?? 0) + 1;
    await this.tx
      .update(notifications)
      .set({ attempts: next })
      .where(and(eq(notifications.tenantId, tenantId), eq(notifications.id, id)));
  }

  /** Check if an email address is suppressed for this tenant. Uses SHA-256 hash. */
  async isSuppressed(tenantId: string, email: string): Promise<boolean> {
    const hash = hashEmail(email);
    const rows = await this.tx
      .select({ emailHash: notificationSuppressions.emailHash })
      .from(notificationSuppressions)
      .where(
        and(
          eq(notificationSuppressions.tenantId, tenantId),
          eq(notificationSuppressions.emailHash, hash),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Upsert a suppression record. Bounce events arrive for unknown addresses too. */
  async upsertSuppression(
    tenantId: string,
    email: string,
    reason: SuppressionReason,
  ): Promise<void> {
    const hash = hashEmail(email);
    await this.tx
      .insert(notificationSuppressions)
      .values({ tenantId, emailHash: hash, reason })
      .onConflictDoNothing({
        target: [notificationSuppressions.tenantId, notificationSuppressions.emailHash],
      });
  }
}

/** SHA-256 of the lowercased email — the only form persisted in the suppression list. */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}
