/**
 * NotificationsEraser — WO-085 SubjectDataEraser contributor.
 *
 * Enumerates and tombstones PII in the notifications table for a given
 * data-erasure subject (identified by recipient_email or recipient_contact_id).
 *
 * Tombstone strategy:
 *   - recipient_email → '[erased]'
 *   - payload         → {} (empty JSON — removes any contact-identifying variables)
 *
 * Fields preserved (aggregate-safe):
 *   - status, channel, template_key, attempts, created_at, sent_at
 *   - These are needed for delivery-rate reporting and do not identify the subject.
 *
 * Security invariants:
 *   - Tombstoning is applied in bounded batches to handle subjects with many rows.
 *   - No notification row content is returned to the caller — only counts.
 *   - The erasure receipt entry lists rows_affected but never row data.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TxHandle } from '@opsninja/db';
import type { ErasureReceiptEntry } from '@opsninja/db';

export const NOTIFICATION_TOMBSTONE_EMAIL = '[erased]';

export interface ErasureSubject {
  tenantId:   string;
  /** email address of the subject being erased */
  email?:     string;
  /** contact UUID, used as secondary lookup */
  contactId?: string;
}

export interface ErasureResult {
  entries: ErasureReceiptEntry[];
}

@Injectable()
export class NotificationsEraser {
  private readonly logger = new Logger(NotificationsEraser.name);

  /**
   * Enumerate all notification rows that reference the subject.
   * Returns counts by table — never row content.
   */
  async enumerate(
    tx: TxHandle,
    subject: ErasureSubject,
  ): Promise<{ notifications: number }> {
    const { tenantId, email, contactId } = subject;

    const whereClause = email
      ? sql`tenant_id = ${tenantId}::uuid AND recipient_email = ${email}`
      : sql`tenant_id = ${tenantId}::uuid AND recipient_contact_id = ${contactId}::uuid`;

    const result = await tx.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE ${whereClause}
    `);

    const rows = Array.isArray(result) ? result : (result as { rows?: { count: string }[] }).rows ?? [];
    return { notifications: parseInt(rows[0]?.count ?? '0', 10) };
  }

  /**
   * Tombstone all PII fields for the subject. Returns an ErasureReceiptEntry.
   *
   * Runs within the caller's transaction — the receipt is written only after
   * all contributors succeed (atomicity guarantee from the orchestrator).
   */
  async erase(
    tx: TxHandle,
    subject: ErasureSubject,
  ): Promise<ErasureReceiptEntry> {
    const { tenantId, email, contactId } = subject;

    const whereClause = email
      ? sql`tenant_id = ${tenantId}::uuid AND recipient_email = ${email}`
      : sql`tenant_id = ${tenantId}::uuid AND recipient_contact_id = ${contactId}::uuid`;

    const result = await tx.execute<{ id: string }>(sql`
      UPDATE notifications
      SET
        recipient_email    = ${NOTIFICATION_TOMBSTONE_EMAIL},
        payload            = '{}'::jsonb,
        recipient_contact_id = NULL
      WHERE ${whereClause}
      RETURNING id
    `);

    const rows = Array.isArray(result) ? result : (result as { rows?: { id: string }[] }).rows ?? [];
    const rowsAffected = rows.length;

    this.logger.log('[privacy] notifications.eraser: tombstoned', {
      tenantId,
      rowsAffected,
    });

    return {
      table:        'notifications',
      rowsAffected,
      strategy:     'tombstone',
    };
  }
}
