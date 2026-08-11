/**
 * NotificationsRepository – Drizzle-backed data access for the notifications module.
 *
 * Extends TenantRepository so all queries automatically use the tenant-bound
 * Drizzle transaction handle from AsyncLocalStorage.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import {
  notifications,
  notificationSuppressions,
  NewNotification,
  Notification,
  NotificationStatus,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';

@Injectable()
export class NotificationsRepository extends TenantRepository {
  /**
   * Inserts a notification row with ON CONFLICT DO NOTHING.
   * Returns the inserted row, or null when dedupe_key already exists (idempotent replay).
   */
  async insertIfNew(row: NewNotification): Promise<Notification | null> {
    const result = await this.db
      .insert(notifications)
      .values(row)
      .onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })
      .returning();

    return result[0] ?? null;
  }

  async findById(id: string): Promise<Notification | null> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    status: NotificationStatus,
    extra?: {
      providerMessageId?: string;
      errorCode?: string;
      sentAt?: Date;
    },
  ): Promise<void> {
    await this.db
      .update(notifications)
      .set({
        status,
        providerMessageId: extra?.providerMessageId,
        errorCode: extra?.errorCode,
        sentAt: extra?.sentAt,
        attempts: sql`${notifications.attempts} + 1`,
      })
      .where(eq(notifications.id, id));
  }

  /**
   * Checks whether an email hash appears in the tenant's suppression list.
   * emailHash must be SHA-256 of the lowercased email address.
   */
  async isSuppressed(tenantId: string, emailHash: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: notificationSuppressions.id })
      .from(notificationSuppressions)
      .where(
        and(
          eq(notificationSuppressions.tenantId, tenantId),
          eq(notificationSuppressions.emailHash, emailHash),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Upserts a suppression record (bounce or complaint). */
  async upsertSuppression(params: {
    tenantId: string;
    emailHash: string;
    reason: string;
  }): Promise<void> {
    await this.db
      .insert(notificationSuppressions)
      .values({
        tenantId: params.tenantId,
        emailHash: params.emailHash,
        reason: params.reason,
      })
      .onConflictDoNothing();
  }
}
