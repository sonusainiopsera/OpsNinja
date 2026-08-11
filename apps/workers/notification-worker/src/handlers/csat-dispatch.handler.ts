/**
 * CsatDispatchHandler – consumes ticket.resolved outbox events and creates
 * CSAT survey records with single-use tokens.
 *
 * Dispatch logic:
 *  1. Parse and validate the inbound event envelope.
 *  2. Check organization csat_enabled flag.
 *  3. Check survey fatigue window: skip if the contact received a CSAT in
 *     the configured window (csat_fatigue_hours, default 72 h).
 *  4. Reopen suppression: skip if an open (unanswered) survey was created
 *     within 24 h of this resolution (ticket reopened and re-resolved quickly).
 *  5. Idempotent insert: ON CONFLICT (tenant_id, ticket_id) DO NOTHING.
 *  6. Enqueue CSAT email via the notification pipeline template key csat_survey.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { csatSurveys, organizations, contacts } from '@opsninja/db';
import { WORKER_DB_POOL } from '../worker.module';
import { EMAIL_SENDER_PORT, EmailSenderPort } from '../ports/email-sender.port';
import { NotificationTemplateService } from '../notification-template.service';

const REOPEN_SUPPRESSION_HOURS = 24;

// ── Inbound event schema ──────────────────────────────────────────────────────

const TicketResolvedEventSchema = z.object({
  tenantId: z.string().uuid(),
  ticketId: z.string().uuid(),
  ticketReference: z.string().min(1),
  ticketSubject: z.string().min(1),
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  contactEmail: z.string().email(),
  contactName: z.string(),
  resolvedAt: z.string().datetime(),
  traceId: z.string().optional(),
});

type TicketResolvedEvent = z.infer<typeof TicketResolvedEventSchema>;

// ── Handler ───────────────────────────────────────────────────────────────────

@Injectable()
export class CsatDispatchHandler {
  private readonly logger = new Logger(CsatDispatchHandler.name);

  constructor(
    @Inject(WORKER_DB_POOL) private readonly pool: Pool,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    private readonly templateService: NotificationTemplateService,
  ) {}

  /** Processes one raw ticket.resolved event body. */
  async handle(rawBody: string): Promise<void> {
    let event: TicketResolvedEvent;
    try {
      event = TicketResolvedEventSchema.parse(JSON.parse(rawBody) as unknown);
    } catch (err) {
      this.logger.error('Invalid ticket.resolved event — discarding', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    await this.processEvent(event);
  }

  private async processEvent(event: TicketResolvedEvent): Promise<void> {
    const {
      tenantId,
      ticketId,
      ticketReference,
      ticketSubject,
      organizationId,
      contactId,
      contactEmail,
      contactName,
      resolvedAt,
      traceId,
    } = event;

    const db = drizzle(this.pool);

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);

      // ── Organization CSAT config ─────────────────────────────────────────
      const orgRows = await tx
        .select({
          csatEnabled: organizations.csatEnabled,
          csatFatigueHours: organizations.csatFatigueHours,
          csatExpiryDays: organizations.csatExpiryDays,
          name: organizations.name,
        })
        .from(organizations)
        .where(and(eq(organizations.tenantId, tenantId), eq(organizations.id, organizationId)))
        .limit(1);

      if (orgRows.length === 0) {
        this.logger.warn('Organization not found; skipping CSAT dispatch', {
          tenantId,
          organizationId,
          traceId,
        });
        return;
      }

      const org = orgRows[0];

      if (!org.csatEnabled) {
        this.logger.log('CSAT disabled for org; skipping', { tenantId, organizationId, traceId });
        return;
      }

      const expiryDays = org.csatExpiryDays;
      const fatigueHours = org.csatFatigueHours;

      // ── Fatigue window check ─────────────────────────────────────────────
      const fatigueWindowStart = new Date(
        new Date(resolvedAt).getTime() - fatigueHours * 3600 * 1000,
      );

      const recentSurveys = await tx
        .select({ id: csatSurveys.id, respondedAt: csatSurveys.respondedAt })
        .from(csatSurveys)
        .where(
          and(
            eq(csatSurveys.tenantId, tenantId),
            eq(csatSurveys.contactId, contactId),
            sql`${csatSurveys.sentAt} >= ${fatigueWindowStart.toISOString()}`,
          ),
        )
        .limit(1);

      if (recentSurveys.length > 0) {
        this.logger.log('CSAT fatigue window active; skipping', {
          tenantId,
          contactId,
          traceId,
        });
        return;
      }

      // ── Reopen suppression ───────────────────────────────────────────────
      // If an unanswered survey was created within REOPEN_SUPPRESSION_HOURS,
      // the ticket was likely reopened and re-resolved too quickly.
      const reopenWindowStart = new Date(
        new Date(resolvedAt).getTime() - REOPEN_SUPPRESSION_HOURS * 3600 * 1000,
      );

      const openSurveys = await tx
        .select({ id: csatSurveys.id })
        .from(csatSurveys)
        .where(
          and(
            eq(csatSurveys.tenantId, tenantId),
            eq(csatSurveys.ticketId, ticketId),
            isNull(csatSurveys.respondedAt),
            sql`${csatSurveys.sentAt} >= ${reopenWindowStart.toISOString()}`,
          ),
        )
        .limit(1);

      if (openSurveys.length > 0) {
        this.logger.log('Reopen suppression: open survey exists within window; skipping', {
          tenantId,
          ticketId,
          traceId,
        });
        return;
      }

      // ── Token generation ─────────────────────────────────────────────────
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');

      const sentAt = new Date(resolvedAt);
      const expiresAt = new Date(sentAt.getTime() + expiryDays * 24 * 3600 * 1000);

      // ── Idempotent survey insert ─────────────────────────────────────────
      const inserted = await tx
        .insert(csatSurveys)
        .values({
          tenantId,
          ticketId,
          contactId,
          tokenHash,
          sentAt,
          expiresAt,
          delivered: false,
        })
        .onConflictDoNothing({ target: [csatSurveys.tenantId, csatSurveys.ticketId] })
        .returning({ id: csatSurveys.id });

      if (inserted.length === 0) {
        this.logger.log('Duplicate ticket.resolved event; CSAT survey already exists', {
          tenantId,
          ticketId,
          traceId,
        });
        return;
      }

      const surveyId = inserted[0].id;

      // ── Render and send CSAT email ───────────────────────────────────────
      const baseUrl = process.env['PORTAL_BASE_URL'] ?? 'https://portal.opsninja.io';
      const surveyUrl = `${baseUrl}/csat/${encodeURIComponent(rawToken)}`;

      const scoreLinks: Record<string, string> = {};
      for (const score of [1, 2, 3, 4, 5]) {
        scoreLinks[`score${score}Url`] = `${surveyUrl}?score=${score}`;
      }

      const rendered = await this.templateService.render(
        'csat_survey',
        {
          ticketReference,
          ticketSubject,
          organizationName: org.name,
          contactName,
          surveyUrl,
          ...scoreLinks,
        } as never,
        'en',
      );

      try {
        await this.emailSender.send({
          to: contactEmail,
          subject: rendered.subject,
          htmlBody: rendered.htmlBody,
          textBody: rendered.textBody,
          referenceId: surveyId,
        });

        // Mark as delivered
        await tx
          .update(csatSurveys)
          .set({ delivered: true })
          .where(and(eq(csatSurveys.tenantId, tenantId), eq(csatSurveys.id, surveyId)));

        this.logger.log('CSAT survey email dispatched', {
          tenantId,
          surveyId,
          ticketId,
          traceId,
        });
      } catch (sendErr) {
        // Keep delivered=false; the survey still exists for aggregation purposes.
        this.logger.warn('CSAT survey email send failed; survey remains undelivered', {
          tenantId,
          surveyId,
          ticketId,
          traceId,
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
        // Re-throw so the message returns to the queue for retry
        throw sendErr;
      }
    });
  }
}
