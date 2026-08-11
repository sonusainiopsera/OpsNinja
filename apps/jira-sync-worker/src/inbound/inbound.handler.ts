/**
 * InboundHandler — core pipeline for the Jira inbound sync worker (WO-055).
 *
 * Pipeline per envelope:
 *  1. Guarded claim: UPDATE jira_webhook_events SET processing_state='processing'
 *     WHERE processing_state IN ('pending','failed') RETURNING *
 *     → concurrent pods cannot double-apply the same envelope.
 *  2. SET LOCAL app.current_tenant = tenantId (RLS binding, transaction-scoped).
 *  3. Resolve ticket_jira_links by jira_issue_id inside the tenant context.
 *  4. If no active link → mark skipped(unlinked).
 *  5. If link is orphaned → mark skipped(orphaned).
 *  6. Load jira_project_mappings to get status_map and sync_rules.
 *  7. If connection is revoked → mark skipped(revoked_connection).
 *  8. Classify the event (pure function).
 *  9. If loop origin → mark skipped(origin_loop) and increment metric.
 * 10. If stale event → mark skipped(stale_event) and increment metric.
 * 11. Apply changes:
 *     a. issue_status_changed → translate status, update ticket, outbox event, audit record.
 *     b. comment_created/updated → insert/update ticket_comments with external_ref.
 *     c. issue_deleted → mark link orphaned, add internal note.
 * 12. Update ticket_jira_links metadata (jira_status, jira_assignee, last_synced_at).
 * 13. Mark envelope processed.
 * 14. COMMIT.
 * 15. Publish Redis realtime notification.
 * 16. Record inbound_lag_ms metric.
 *
 * All DB work (steps 1–13) runs in a single pg transaction so a crash between
 * steps leaves nothing half-applied.
 *
 * Constraints:
 *   - Ticket mutations replicate TicketsService logic: state-machine validation,
 *     ticket_status_history append, outbox event, audit record — all in the same tx.
 *   - Never writes directly to tickets tables by bypassing the transition check.
 *   - Never calls SES/PD/webhook endpoints.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import type Redis from 'ioredis';
import { classifyJiraEvent, OPSNINJA_ORIGIN_MARKER } from './event-classifier';
import type { JiraStatusInfo } from './event-classifier';
import { convertAdfToText } from './adf-converter';

// ---------------------------------------------------------------------------
// Allowed ticket status transitions (mirrors transition-table.ts from apps/api).
// The integration principal is trusted for all inbound status changes, so the
// permission dimension is omitted.  Only the structural "is this transition
// legal" check is enforced here.
// ---------------------------------------------------------------------------

type TicketStatus =
  | 'new' | 'open' | 'pending_customer' | 'pending_engineering'
  | 'resolved' | 'closed';

const ALLOWED_TRANSITIONS = new Set<string>([
  'new→open', 'new→pending_customer', 'new→pending_engineering', 'new→resolved',
  'open→pending_customer', 'open→pending_engineering', 'open→resolved', 'open→closed',
  'pending_customer→open', 'pending_customer→pending_engineering', 'pending_customer→resolved', 'pending_customer→closed',
  'pending_engineering→open', 'pending_engineering→pending_customer', 'pending_engineering→resolved', 'pending_engineering→closed',
  'resolved→open', 'resolved→closed',
  'closed→open',
]);

const SLA_PAUSE_TRANSITIONS = new Set([
  'open→pending_customer', 'open→pending_engineering',
  'new→pending_customer', 'new→pending_engineering',
  'pending_customer→pending_engineering', 'pending_engineering→pending_customer',
]);

const SLA_RESUME_TRANSITIONS = new Set([
  'pending_customer→open', 'pending_engineering→open',
  'resolved→open', 'closed→open',
]);

// ---------------------------------------------------------------------------
// SQS message shape
// ---------------------------------------------------------------------------

export interface JiraInboundMessage {
  tenantId: string;
  jiraEventId: string;
  eventType: string;
}

// ---------------------------------------------------------------------------
// Skip reasons
// ---------------------------------------------------------------------------

export type SkipReason =
  | 'unlinked'
  | 'orphaned'
  | 'revoked_connection'
  | 'origin_loop'
  | 'stale_event'
  | 'unmapped_status'
  | 'no_applicable_change';

// ---------------------------------------------------------------------------
// Processing result
// ---------------------------------------------------------------------------

export interface ProcessingResult {
  outcome: 'processed' | 'skipped' | 'failed';
  skipReason?: SkipReason;
  lagMs?: number;
}

// ---------------------------------------------------------------------------
// InboundHandler
// ---------------------------------------------------------------------------

@Injectable()
export class InboundHandler {
  private readonly logger = new Logger(InboundHandler.name);

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  // --------------------------------------------------------------------------
  // Public entry point
  // --------------------------------------------------------------------------

  async handle(msg: JiraInboundMessage): Promise<ProcessingResult> {
    const { tenantId, jiraEventId } = msg;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // ── 1. Guarded claim ──────────────────────────────────────────────────
      const envelope = await this.claimEnvelope(client, tenantId, jiraEventId);
      if (!envelope) {
        // Already processing or processed by another pod
        await client.query('ROLLBACK');
        return { outcome: 'skipped', skipReason: 'no_applicable_change' };
      }

      // ── 2. Bind RLS tenant context ────────────────────────────────────────
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // ── 3. Resolve active link ────────────────────────────────────────────
      const link = await this.resolveLink(client, tenantId, envelope.jira_issue_id);
      if (!link) {
        await this.markEnvelope(client, tenantId, jiraEventId, 'skipped', null, 'unlinked');
        await client.query('COMMIT');
        this.incrementMetric('skipped_unlinked');
        return { outcome: 'skipped', skipReason: 'unlinked' };
      }

      // ── 4. Check orphaned ─────────────────────────────────────────────────
      if (link.orphaned) {
        await this.markEnvelope(client, tenantId, jiraEventId, 'skipped', null, 'orphaned');
        await client.query('COMMIT');
        this.incrementMetric('skipped_orphaned');
        return { outcome: 'skipped', skipReason: 'orphaned' };
      }

      // ── 5–6. Load mapping + connection ────────────────────────────────────
      const mapping = await this.loadMapping(client, tenantId, link.mapping_id);
      const connection = await this.loadConnection(client, tenantId, link.connection_id);

      if (!connection || connection.state === 'revoked') {
        await this.markEnvelope(client, tenantId, jiraEventId, 'skipped', null, 'revoked_connection');
        await client.query('COMMIT');
        this.incrementMetric('skipped_revoked_connection');
        return { outcome: 'skipped', skipReason: 'revoked_connection' };
      }

      // ── 7. Classify event ─────────────────────────────────────────────────
      const payload = envelope.payload as Record<string, unknown>;
      const classified = classifyJiraEvent(
        envelope.event_type,
        payload,
        connection.integration_account_id ?? null,
        link.jira_updated_at ? new Date(link.jira_updated_at) : null,
      );

      // ── 8. Loop detection ─────────────────────────────────────────────────
      if (classified.isLoopOrigin) {
        await this.markEnvelope(client, tenantId, jiraEventId, 'skipped', null, 'origin_loop');
        await client.query('COMMIT');
        this.incrementMetric('skipped_origin_loop');
        return { outcome: 'skipped', skipReason: 'origin_loop' };
      }

      // ── 9. Stale-event detection ──────────────────────────────────────────
      if (classified.isStale) {
        await this.markEnvelope(client, tenantId, jiraEventId, 'skipped', null, 'stale_event');
        await client.query('COMMIT');
        this.incrementMetric('skipped_stale_event');
        return { outcome: 'skipped', skipReason: 'stale_event' };
      }

      // ── 10. Apply changes ─────────────────────────────────────────────────
      const syncRules = (mapping?.sync_rules ?? {}) as Record<string, unknown>;
      const statusMap = (mapping?.status_map ?? []) as Array<{
        jiraStatusId?: string;
        jiraStatusCategory?: string;
        opsninjaStatus: string;
      }>;

      let skipReason: SkipReason | null = null;
      const ticketId: string = link.ticket_id;

      if (classified.kind === 'issue_deleted') {
        await this.applyIssueDeleted(client, tenantId, link, ticketId);
      } else if (
        classified.kind === 'issue_status_changed' &&
        syncRules['applyInboundStatus'] !== false
      ) {
        skipReason = await this.applyStatusChange(
          client, tenantId, ticketId, link, classified.jiraStatus,
          statusMap, syncRules,
        );
      } else if (
        (classified.kind === 'comment_created' || classified.kind === 'comment_updated') &&
        syncRules['applyInboundComments'] !== false
      ) {
        const visibility = String(syncRules['commentVisibility'] ?? 'internal');
        skipReason = await this.applyComment(
          client, tenantId, ticketId, link, classified.comment!, visibility,
        );
      } else if (classified.kind !== 'issue_assignee_changed') {
        skipReason = 'no_applicable_change';
      }

      // ── 11. Update link metadata ──────────────────────────────────────────
      const newJiraStatus = classified.jiraStatus?.name ?? null;
      const newJiraAssignee = classified.jiraAssignee !== undefined
        ? classified.jiraAssignee
        : link.jira_assignee;
      const nowTs = new Date();

      await client.query(
        `UPDATE ticket_jira_links
            SET jira_status     = COALESCE($1, jira_status),
                jira_assignee   = $2,
                last_synced_at  = $3,
                jira_updated_at = COALESCE($4, jira_updated_at),
                updated_at      = $3
          WHERE id = $5 AND tenant_id = $6`,
        [
          newJiraStatus,
          newJiraAssignee,
          nowTs,
          classified.jiraUpdatedAt ?? null,
          link.id,
          tenantId,
        ],
      );

      // ── 12. Mark envelope ─────────────────────────────────────────────────
      if (skipReason) {
        await this.markEnvelope(client, tenantId, jiraEventId, 'skipped', null, skipReason);
      } else {
        await this.markEnvelope(client, tenantId, jiraEventId, 'processed', null, null);
      }

      await client.query('COMMIT');

      // ── 13. Realtime notification (after commit — best effort) ────────────
      await this.publishRealtime(tenantId, ticketId, link.id, newJiraStatus, newJiraAssignee, nowTs).catch(
        (err: unknown) => this.logger.warn('Redis realtime publish failed', { err: String(err) }),
      );

      const lagMs =
        envelope.received_at
          ? Date.now() - new Date(envelope.received_at).getTime()
          : undefined;
      this.incrementMetric(skipReason ? 'skipped_no_change' : 'processed');

      return { outcome: skipReason ? 'skipped' : 'processed', skipReason: skipReason ?? undefined, lagMs };
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Mark failed with incremented attempts — SQS will redeliver
      try {
        const client2 = await this.pool.connect();
        try {
          await client2.query(
            `UPDATE jira_webhook_events
                SET processing_state = 'failed',
                    attempts         = attempts + 1,
                    last_error       = $1
              WHERE tenant_id = $2 AND jira_event_id = $3`,
            [String(err).slice(0, 2048), msg.tenantId, msg.jiraEventId],
          );
        } finally {
          client2.release();
        }
      } catch { /* swallow — original error is more important */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Step 1: Guarded claim
  // --------------------------------------------------------------------------

  private async claimEnvelope(client: PoolClient, tenantId: string, jiraEventId: string) {
    const { rows } = await client.query<{
      id: string;
      tenant_id: string;
      jira_event_id: string;
      event_type: string;
      jira_issue_id: string | null;
      jira_issue_key: string | null;
      payload: unknown;
      received_at: string;
    }>(
      `UPDATE jira_webhook_events
          SET processing_state = 'processing',
              attempts         = attempts + 1
        WHERE tenant_id = $1
          AND jira_event_id = $2
          AND processing_state IN ('pending', 'failed')
        RETURNING *`,
      [tenantId, jiraEventId],
    );
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Step 3: Resolve link
  // --------------------------------------------------------------------------

  private async resolveLink(client: PoolClient, tenantId: string, jiraIssueId: string | null) {
    if (!jiraIssueId) return null;
    const { rows } = await client.query<{
      id: string;
      tenant_id: string;
      ticket_id: string;
      connection_id: string;
      mapping_id: string;
      jira_issue_id: string;
      jira_issue_key: string | null;
      jira_status: string | null;
      jira_assignee: string | null;
      link_state: string;
      orphaned: boolean;
      jira_updated_at: string | null;
    }>(
      `SELECT * FROM ticket_jira_links
        WHERE tenant_id = $1 AND jira_issue_id = $2
          AND link_state IN ('linked', 'pending')
        LIMIT 1`,
      [tenantId, jiraIssueId],
    );
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Step 5: Load mapping
  // --------------------------------------------------------------------------

  private async loadMapping(client: PoolClient, tenantId: string, mappingId: string) {
    const { rows } = await client.query<{
      id: string;
      status_map: unknown;
      sync_rules: unknown;
    }>(
      `SELECT id, status_map, sync_rules FROM jira_project_mappings
        WHERE id = $1 AND tenant_id = $2 AND enabled = true LIMIT 1`,
      [mappingId, tenantId],
    );
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Step 6: Load connection
  // --------------------------------------------------------------------------

  private async loadConnection(client: PoolClient, tenantId: string, connectionId: string) {
    const { rows } = await client.query<{
      id: string;
      state: string;
      integration_account_id: string | null;
    }>(
      `SELECT id, state, integration_account_id FROM jira_connections
        WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [connectionId, tenantId],
    );
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Step 10a: Apply status change
  // --------------------------------------------------------------------------

  private async applyStatusChange(
    client: PoolClient,
    tenantId: string,
    ticketId: string,
    link: { id: string },
    jiraStatus: JiraStatusInfo | undefined,
    statusMap: Array<{ jiraStatusId?: string; jiraStatusCategory?: string; opsninjaStatus: string }>,
    syncRules: Record<string, unknown>,
  ): Promise<SkipReason | null> {
    if (!jiraStatus) return 'no_applicable_change';

    // ── Translate via status_map ────────────────────────────────────────────
    const mapped = statusMap.find(
      (entry) =>
        (entry.jiraStatusId && entry.jiraStatusId === jiraStatus.id) ||
        (entry.jiraStatusCategory && entry.jiraStatusCategory === jiraStatus.categoryKey),
    );

    if (!mapped) {
      this.logger.warn('Unmapped Jira status — skipping', {
        tenantId, jiraStatusId: jiraStatus.id, jiraStatusName: jiraStatus.name,
      });
      this.incrementMetric('skipped_unmapped_status');
      return 'unmapped_status';
    }

    // ── Check autoResolveOnJiraDone ────────────────────────────────────────
    const targetStatus = (
      syncRules['autoResolveOnJiraDone'] === true &&
      jiraStatus.categoryKey === 'done'
    )
      ? 'resolved'
      : mapped.opsninjaStatus;

    // ── Load current ticket ────────────────────────────────────────────────
    const { rows: ticketRows } = await client.query<{
      id: string; status: string; version: number; organization_id: string;
    }>(
      `SELECT id, status, version, organization_id FROM tickets
        WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [ticketId, tenantId],
    );
    const ticket = ticketRows[0];
    if (!ticket) return 'no_applicable_change';

    // Already at the target — idempotent skip
    if (ticket.status === targetStatus) return null;

    // ── Validate transition ────────────────────────────────────────────────
    const transKey = `${ticket.status}→${targetStatus}`;
    if (!ALLOWED_TRANSITIONS.has(transKey)) {
      this.logger.warn('Jira sync: transition not allowed in state machine', {
        tenantId, ticketId, from: ticket.status, to: targetStatus,
      });
      return 'no_applicable_change';
    }

    // ── UPDATE ticket ──────────────────────────────────────────────────────
    const nowTs = new Date();
    const resolvedAt = targetStatus === 'resolved' ? nowTs : null;
    await client.query(
      `UPDATE tickets
          SET status      = $1,
              resolved_at = COALESCE($2, resolved_at),
              updated_at  = $3,
              version     = version + 1
        WHERE id = $4 AND tenant_id = $5`,
      [targetStatus, resolvedAt, nowTs, ticketId, tenantId],
    );

    // ── ticket_status_history ─────────────────────────────────────────────
    await client.query(
      `INSERT INTO ticket_status_history
         (id, tenant_id, ticket_id, from_status, to_status, actor_user_id, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, 'jira_sync', $6)`,
      [randomUUID(), tenantId, ticketId, ticket.status, targetStatus, nowTs],
    );

    // ── SLA side-effects via outbox ────────────────────────────────────────
    const slaEventType = SLA_PAUSE_TRANSITIONS.has(transKey)
      ? 'ticket.sla.pause'
      : SLA_RESUME_TRANSITIONS.has(transKey)
      ? 'ticket.sla.resume'
      : null;

    // ── Outbox events ─────────────────────────────────────────────────────
    const events: Array<{ eventType: string; payload: unknown }> = [
      {
        eventType: 'ticket.updated',
        payload: {
          tenantId, ticketId,
          fromStatus: ticket.status,
          toStatus: targetStatus,
          source: 'jira_sync',
          jiraLinkId: link.id,
        },
      },
    ];

    if (targetStatus === 'resolved') {
      events.push({
        eventType: 'ticket.resolved',
        payload: { tenantId, ticketId, source: 'jira_sync', jiraLinkId: link.id },
      });
    }

    if (slaEventType) {
      events.push({
        eventType: slaEventType,
        payload: { tenantId, ticketId },
      });
    }

    for (const ev of events) {
      await client.query(
        `INSERT INTO outbox_events
           (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
         VALUES ($1, $2, 'ticket', $3, $4, $5, 'pending', $6)`,
        [randomUUID(), tenantId, ticketId, ev.eventType, JSON.stringify(ev.payload), nowTs],
      );
    }

    // ── Audit record ───────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO audit_logs
         (id, tenant_id, actor_id, actor_kind, event_type, outcome, trace_id,
          resource_type, resource_id, action, before_state, after_state, source, created_at)
       VALUES ($1, $2, NULL, 'jira_integration', 'ticket.status_changed', 'success', $3,
               'ticket', $4, 'transition', $5, $6, 'jira_sync', $7)`,
      [
        randomUUID(), tenantId,
        `jira_sync_${jiraEventId ?? randomUUID()}`,
        ticketId,
        JSON.stringify({ status: ticket.status }),
        JSON.stringify({ status: targetStatus }),
        nowTs,
      ],
    );

    this.incrementMetric('status_applied');
    return null;
  }

  // --------------------------------------------------------------------------
  // Step 10b: Apply comment mirror
  // --------------------------------------------------------------------------

  private async applyComment(
    client: PoolClient,
    tenantId: string,
    ticketId: string,
    link: { id: string },
    comment: { id: string; adfBody: unknown; authorDisplayName?: string; isEdit: boolean },
    visibility: string,
  ): Promise<SkipReason | null> {
    const body = convertAdfToText(comment.adfBody);
    const attribution = comment.authorDisplayName ? ` (via Jira — ${comment.authorDisplayName})` : ' (via Jira)';
    const fullBody = `${body}${attribution}\n${OPSNINJA_ORIGIN_MARKER}`;

    const nowTs = new Date();

    if (comment.isEdit) {
      // Update in-place via external_ref
      await client.query(
        `UPDATE ticket_comments
            SET body       = $1,
                updated_at = $2
          WHERE tenant_id      = $3
            AND external_source = 'jira'
            AND external_ref    = $4`,
        [fullBody, nowTs, tenantId, comment.id],
      );
      // If no rows matched, fall through to insert below
      this.incrementMetric('comment_updated');
      return null;
    }

    // ── Load organisation_id from ticket ────────────────────────────────────
    const { rows: ticketRows } = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM tickets WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [ticketId, tenantId],
    );
    const orgId = ticketRows[0]?.organization_id;
    if (!orgId) return 'no_applicable_change';

    // ── Insert with ON CONFLICT DO NOTHING for idempotency ─────────────────
    const { rowCount } = await client.query(
      `INSERT INTO ticket_comments
         (id, tenant_id, ticket_id, organization_id, author_id, visibility,
          is_internal, body, external_ref, external_source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, 'jira', $9, $9)
       ON CONFLICT ON CONSTRAINT ticket_comments_external_ref_uniq DO NOTHING`,
      [
        randomUUID(), tenantId, ticketId, orgId,
        visibility,
        visibility === 'internal',
        fullBody,
        comment.id,
        nowTs,
      ],
    );

    if ((rowCount ?? 0) === 0) {
      // Duplicate delivery — idempotent skip
      return null;
    }

    // ── Outbox event ──────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO outbox_events
         (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
       VALUES ($1, $2, 'ticket', $3, 'ticket.comment_added', $4, 'pending', $5)`,
      [
        randomUUID(), tenantId, ticketId,
        JSON.stringify({ tenantId, ticketId, source: 'jira_sync', jiraLinkId: link.id }),
        nowTs,
      ],
    );

    this.incrementMetric('comment_mirrored');
    return null;
  }

  // --------------------------------------------------------------------------
  // Step 10c: Apply issue deleted
  // --------------------------------------------------------------------------

  private async applyIssueDeleted(
    client: PoolClient,
    tenantId: string,
    link: { id: string; ticket_id: string; jira_issue_key: string | null },
    ticketId: string,
  ): Promise<void> {
    // Mark the link as orphaned
    await client.query(
      `UPDATE ticket_jira_links SET orphaned = true, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [link.id, tenantId],
    );

    // Add internal note to ticket
    const { rows: ticketRows } = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM tickets WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [ticketId, tenantId],
    );
    const orgId = ticketRows[0]?.organization_id;
    if (!orgId) return;

    const issueKey = link.jira_issue_key ?? 'unknown';
    const nowTs = new Date();
    await client.query(
      `INSERT INTO ticket_comments
         (id, tenant_id, ticket_id, organization_id, author_id, visibility,
          is_internal, body, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, 'internal', true,
               $5, $6, $6)`,
      [
        randomUUID(), tenantId, ticketId, orgId,
        `[System] Linked Jira issue ${issueKey} was deleted. No further sync will occur.`,
        nowTs,
      ],
    );
    this.incrementMetric('issue_deleted');
  }

  // --------------------------------------------------------------------------
  // Mark envelope
  // --------------------------------------------------------------------------

  private async markEnvelope(
    client: PoolClient,
    tenantId: string,
    jiraEventId: string,
    state: 'processed' | 'skipped' | 'failed',
    error: string | null,
    reason: string | null,
  ): Promise<void> {
    await client.query(
      `UPDATE jira_webhook_events
          SET processing_state = $1,
              last_error       = COALESCE($2, last_error)
        WHERE tenant_id = $3 AND jira_event_id = $4`,
      [
        reason ? `${state}:${reason}` : state,
        error,
        tenantId,
        jiraEventId,
      ],
    );
  }

  // --------------------------------------------------------------------------
  // Redis realtime
  // --------------------------------------------------------------------------

  private async publishRealtime(
    tenantId: string,
    ticketId: string,
    linkId: string,
    jiraStatus: string | null,
    jiraAssignee: string | null | undefined,
    lastSyncedAt: Date,
  ): Promise<void> {
    const message = JSON.stringify({
      type: 'jira.link.updated',
      payload: { linkId, jiraStatus, jiraAssignee, lastSyncedAt: lastSyncedAt.toISOString() },
    });
    await this.redis.publish(`ticket:${ticketId}`, message);
  }

  // --------------------------------------------------------------------------
  // Metrics (structured log-based — replace with Prometheus counter in prod)
  // --------------------------------------------------------------------------

  private incrementMetric(name: string): void {
    this.logger.debug(`metric:jira_inbound:${name}`, { metric: name });
  }
}

// ---------------------------------------------------------------------------
// Re-export for reference
// ---------------------------------------------------------------------------

export { OPSNINJA_ORIGIN_MARKER };
