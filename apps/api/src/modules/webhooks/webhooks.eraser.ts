/**
 * WebhooksEraser — WO-085 SubjectDataEraser contributor.
 *
 * Enumerates and tombstones PII in webhook_deliveries for a data-erasure
 * subject. Webhook deliveries may contain PII in:
 *   - canonical_payload  — the full event payload may include contact details,
 *                          ticket subject, or customer PII
 *   - response_snippet   — the webhook target's HTTP response body may echo
 *                          request fields including PII
 *
 * Tombstone strategy:
 *   - canonical_payload → '{"erased":true}'  (valid JSON, marks erasure)
 *   - response_snippet  → '[erased]'
 *
 * Fields preserved:
 *   - event_type, status, http_status, latency_ms, attempt, created_at
 *   - These are needed for webhook delivery reporting and contain no PII.
 *
 * Subject linkage:
 *   Webhook deliveries are linked to a subject via canonical_payload->>'subject_id'
 *   or by referencing tickets/contacts. Since the payload is opaque JSONB,
 *   we tombstone all deliveries for the tenant that reference the subject_id
 *   in the standard payload envelope.
 *
 * Security invariants:
 *   - payload contents are never logged — only row counts.
 *   - The erasure uses parameterised SQL; no user data is interpolated.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TxHandle } from '@opsninja/db';
import type { ErasureReceiptEntry } from '@opsninja/db';

export const WEBHOOK_TOMBSTONE_PAYLOAD  = { erased: true };
export const WEBHOOK_TOMBSTONE_SNIPPET  = '[erased]';

export interface WebhookErasureSubject {
  tenantId:  string;
  /** The subject_id embedded in canonical_payload (contact_id or portal_user_id) */
  subjectId: string;
}

@Injectable()
export class WebhooksEraser {
  private readonly logger = new Logger(WebhooksEraser.name);

  /**
   * Enumerate webhook delivery rows that reference the subject.
   */
  async enumerate(
    tx: TxHandle,
    subject: WebhookErasureSubject,
  ): Promise<{ webhookDeliveries: number }> {
    const { tenantId, subjectId } = subject;

    const result = await tx.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM webhook_deliveries
      WHERE tenant_id = ${tenantId}::uuid
        AND (
          canonical_payload->>'subject_id' = ${subjectId}
          OR canonical_payload->>'contact_id' = ${subjectId}
        )
    `);

    const rows = Array.isArray(result) ? result : (result as { rows?: { count: string }[] }).rows ?? [];
    return { webhookDeliveries: parseInt(rows[0]?.count ?? '0', 10) };
  }

  /**
   * Tombstone PII fields in webhook delivery rows for the subject.
   */
  async erase(
    tx: TxHandle,
    subject: WebhookErasureSubject,
  ): Promise<ErasureReceiptEntry> {
    const { tenantId, subjectId } = subject;

    const result = await tx.execute<{ id: string }>(sql`
      UPDATE webhook_deliveries
      SET
        canonical_payload = '{"erased":true}'::jsonb,
        response_snippet  = ${WEBHOOK_TOMBSTONE_SNIPPET}
      WHERE tenant_id = ${tenantId}::uuid
        AND (
          canonical_payload->>'subject_id' = ${subjectId}
          OR canonical_payload->>'contact_id' = ${subjectId}
        )
      RETURNING id
    `);

    const rows = Array.isArray(result) ? result : (result as { rows?: { id: string }[] }).rows ?? [];
    const rowsAffected = rows.length;

    this.logger.log('[privacy] webhooks.eraser: tombstoned', {
      tenantId,
      rowsAffected,
    });

    return {
      table:        'webhook_deliveries',
      rowsAffected,
      strategy:     'tombstone',
    };
  }
}
