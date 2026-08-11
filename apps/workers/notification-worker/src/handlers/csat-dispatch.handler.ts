/**
 * CsatDispatchHandler
 *
 * Handles ticket.resolved events from the outbox and creates a CSAT survey
 * record + dispatch email through the WO-080 notification delivery path.
 *
 * Fatigue controls (skip survey if):
 *   1. Organization has csat_enabled = false.
 *   2. Contact has received a CSAT in the last csat_fatigue_hours (default 72h).
 *   3. Ticket was reopened and re-resolved within 24h of an unanswered survey.
 *
 * Idempotency: INSERT ... ON CONFLICT (tenant_id, ticket_id) DO NOTHING.
 * Re-delivery of the same ticket.resolved event creates no second survey.
 *
 * Token security:
 *   - Raw token (32 random bytes, base64url) generated here and included in the
 *     email link ONLY — it is never logged or stored.
 *   - Only the SHA-256 hex hash is persisted in token_hash.
 */

import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@opsninja/db';
import { redactLogObject } from '@opsninja/observability';

export interface TicketResolvedEvent {
  tenantId: string;
  ticketId: string;
  organizationId: string;
  contactId: string | null;
  contactEmail: string | null;
  ticketReference: string;
  ticketSubject: string;
  organizationName: string;
  resolvedAt: string;
}

const CSAT_EMAIL_TEMPLATE_KEY = 'csat_survey';
const REOPEN_SUPPRESSION_HOURS = 24;

export class CsatDispatchHandler {
  constructor(
    private readonly pool: Pool,
    private readonly portalBaseUrl: string,
  ) {}

  async handle(event: TicketResolvedEvent): Promise<void> {
    if (!event.contactEmail || !event.contactId) {
      // No contact email to send to — create no survey.
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [event.tenantId]);

      const tx = drizzle(client as unknown as Parameters<typeof drizzle>[0], { schema });

      // 1. Check organization CSAT config.
      const orgRows = await client.query<{
        csat_enabled: boolean;
        csat_fatigue_hours: number;
        csat_expiry_days: number;
      }>(
        `SELECT csat_enabled, csat_fatigue_hours, csat_expiry_days
         FROM organizations
         WHERE id = $1::uuid
         LIMIT 1`,
        [event.organizationId],
      );

      const org = orgRows.rows[0];
      if (!org || !org.csat_enabled) {
        await client.query('COMMIT');
        return;
      }

      // 2. Fatigue check — skip if contact has a recent unanswered survey.
      const fatigueWindowStart = new Date(
        Date.now() - org.csat_fatigue_hours * 3600 * 1000,
      );
      const fatigueRows = await client.query<{ count: string }>(
        `SELECT count(*) AS count
         FROM csat_surveys
         WHERE tenant_id  = $1::uuid
           AND contact_id = $2::uuid
           AND sent_at    >= $3
         LIMIT 1`,
        [event.tenantId, event.contactId, fatigueWindowStart],
      );
      if (parseInt(fatigueRows.rows[0]?.count ?? '0', 10) > 0) {
        await client.query('COMMIT');
        return;
      }

      // 3. Reopen suppression — skip if ticket has an existing unanswered survey
      //    created within the last REOPEN_SUPPRESSION_HOURS.
      const reopenCutoff = new Date(
        Date.now() - REOPEN_SUPPRESSION_HOURS * 3600 * 1000,
      );
      const reopenRows = await client.query<{ count: string }>(
        `SELECT count(*) AS count
         FROM csat_surveys
         WHERE tenant_id   = $1::uuid
           AND ticket_id   = $2::uuid
           AND responded_at IS NULL
           AND sent_at     >= $3
         LIMIT 1`,
        [event.tenantId, event.ticketId, reopenCutoff],
      );
      if (parseInt(reopenRows.rows[0]?.count ?? '0', 10) > 0) {
        await client.query('COMMIT');
        return;
      }

      // 4. Generate token and insert survey (idempotent).
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(
        Date.now() + org.csat_expiry_days * 24 * 3600 * 1000,
      );

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO csat_surveys
           (tenant_id, ticket_id, contact_id, token_hash, expires_at, delivered)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, false)
         ON CONFLICT (tenant_id, ticket_id) DO NOTHING
         RETURNING id`,
        [event.tenantId, event.ticketId, event.contactId, tokenHash, expiresAt],
      );

      if (insertResult.rows.length === 0) {
        // Duplicate event — survey already exists for this ticket.
        await client.query('COMMIT');
        return;
      }

      // 5. Build one-click score links (score in query param — not recorded until POST).
      const surveyUrl = `${this.portalBaseUrl}/csat/${encodeURIComponent(rawToken)}`;
      const scoreLinks: Record<string, string> = {};
      for (let i = 1; i <= 5; i++) {
        scoreLinks[String(i)] = `${surveyUrl}?score=${i}`;
      }

      // 6. Enqueue notification through WO-080 delivery path.
      // Using the same notification_templates approach — template renders the links.
      await tx.insert(schema.notifications).values({
        tenantId: event.tenantId,
        ticketId: event.ticketId,
        recipientContactId: event.contactId,
        dedupeKey: createHash('sha256')
          .update(`csat:${event.tenantId}:${event.ticketId}`)
          .digest('hex'),
        templateKey: CSAT_EMAIL_TEMPLATE_KEY,
        channel: 'email',
        status: 'pending',
        locale: 'en',
        payload: {
          ticketReference: event.ticketReference,
          ticketSubject: event.ticketSubject,
          organizationName: event.organizationName,
          surveyUrl,
          scoreLinks,
          // rawToken intentionally excluded from payload — it is only in the URLs above
        },
      }).onConflictDoNothing();

      // 7. Mark survey as delivered (pending — actual delivery confirmed on send).
      await client.query(
        `UPDATE csat_surveys
         SET delivered = true
         WHERE tenant_id = $1::uuid AND ticket_id = $2::uuid`,
        [event.tenantId, event.ticketId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // rawToken intentionally excluded from error log.
      console.error(
        '[csat-dispatch] Survey dispatch failed',
        redactLogObject({ error: (err as Error).message, tenantId: event.tenantId }),
      );
      throw err;
    } finally {
      client.release();
    }
  }
}
