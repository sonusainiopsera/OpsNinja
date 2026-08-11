/**
 * reconciliation.job.ts — hourly per-connection Jira link reconciliation (WO-057).
 *
 * Triggered by an SQS message with source='jira-reconciliation':
 *   { source: 'jira-reconciliation', tenantId, connectionId, lookbackHours?, manualRunId? }
 *
 * Pipeline per connection:
 *  1. Acquire pg_advisory_xact_lock on hash(connectionId) — prevents concurrent runs.
 *  2. Validate connection state (skip revoked/degraded).
 *  3. Load enabled project mappings — exit 'skipped' if none.
 *  4. Build JQL, paginate Jira search (bounded by RECON_MAX_PAGES).
 *  5. For each returned issue:
 *     a. Match against active ticket_jira_links rows (by jira_issue_id).
 *     b. Run detectDrift() — skip unchanged issues.
 *     c. Insert synthetic jira_webhook_events row (ON CONFLICT DO NOTHING).
 *     d. Enqueue to jira-sync SQS queue.
 *  6. Repair pending links older than PENDING_REPAIR_AGE_MINUTES.
 *  7. Detect orphaned links (404 on probe).
 *  8. Update connection watermark. Close run record with counts + duration.
 *  9. Emit metrics.
 *
 * Constraints:
 *   - Shares the same Redis token bucket as OutboundHandler (per-tenant budget).
 *   - A single run is bounded to RECON_MAX_PAGES × RECON_PAGE_SIZE issues.
 *   - All DB mutations are idempotent via ON CONFLICT DO NOTHING.
 *   - Never updates or deletes jira_webhook_events rows.
 *   - No sleep — rate limiting is done by acquiring a token before each Jira call.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';

import { JiraOperationsService, JiraApiError } from '../outbound/jira-operations.service';
import { JiraRateLimiter } from '../outbound/rate-limiter';
import { classifyJiraError } from '../outbound/error-classifier';
import { buildReconciliationJql } from './jql-builder';
import { detectDrift, buildSyntheticEnvelope, decidePendingRepair } from './drift-detector';
import type { JiraSearchIssue, CachedLinkState } from './drift-detector';
import {
  RECON_LOOKBACK_DEFAULT_HOURS,
  RECON_MAX_PAGES,
  PENDING_REPAIR_AGE_MINUTES,
} from '@opsninja/db';

// ---------------------------------------------------------------------------
// SQS message shape
// ---------------------------------------------------------------------------

export interface JiraReconciliationMessage {
  source: 'jira-reconciliation';
  tenantId: string;
  connectionId: string;
  /** Override per-connection default. Capped by RECON_LOOKBACK_MAX_HOURS. */
  lookbackHours?: number;
  /** Present when triggered by the manual reconcile API endpoint. */
  manualRunId?: string;
}

// ---------------------------------------------------------------------------
// Jira search API response
// ---------------------------------------------------------------------------

interface JiraSearchResponse {
  total: number;
  maxResults: number;
  startAt: number;
  issues: JiraSearchIssue[];
  nextPage?: string; // present on some Jira versions
}

// ---------------------------------------------------------------------------
// Outcome counters (mutable within a run)
// ---------------------------------------------------------------------------

interface RunCounters {
  issuesScanned: number;
  driftDetected: number;
  eventsSynthesised: number;
  pendingRepaired: number;
  orphansFound: number;
}

// ---------------------------------------------------------------------------
// ReconciliationJob
// ---------------------------------------------------------------------------

@Injectable()
export class ReconciliationJob {
  private readonly logger = new Logger(ReconciliationJob.name);

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
    private readonly jiraOps: JiraOperationsService,
    private readonly rateLimiter: JiraRateLimiter,
    private readonly sqsClient: SQSClient,
    private readonly jiraSyncQueueUrl: string,
  ) {}

  // --------------------------------------------------------------------------
  // Public entry point — called by SqsConsumerService
  // --------------------------------------------------------------------------

  async handle(msg: JiraReconciliationMessage): Promise<void> {
    const { tenantId, connectionId } = msg;
    const lookbackHours = msg.lookbackHours ?? RECON_LOOKBACK_DEFAULT_HOURS;
    const startedAt = Date.now();

    this.logger.log('Reconciliation job started', { tenantId, connectionId, lookbackHours });

    let runId: string | null = null;
    const counters: RunCounters = {
      issuesScanned: 0,
      driftDetected: 0,
      eventsSynthesised: 0,
      pendingRepaired: 0,
      orphansFound: 0,
    };

    let outcome: string = 'failed';
    let errorMsg: string | null = null;

    try {
      // ── 1. Open run record ─────────────────────────────────────────────
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - lookbackHours * 3_600_000);

      runId = await this.openRunRecord(tenantId, connectionId, windowStart, windowEnd);

      // ── 2. Advisory lock — one run per connection at a time ────────────
      const locked = await this.tryAdvisoryLock(connectionId);
      if (!locked) {
        this.logger.warn('Reconciliation already running — skipping', { connectionId });
        await this.closeRunRecord(runId, tenantId, 'skipped', counters, startedAt, null, 'advisory_lock_held');
        return;
      }

      // ── 3. Load connection (state + credentials) ───────────────────────
      const connection = await this.loadConnection(tenantId, connectionId);
      if (!connection) {
        await this.closeRunRecord(runId, tenantId, 'skipped', counters, startedAt, null, 'connection_not_found');
        return;
      }

      if (connection.state === 'revoked' || connection.state === 'degraded') {
        this.logger.warn('Skipping reconciliation — connection not active', {
          tenantId, connectionId, state: connection.state,
        });
        await this.closeRunRecord(runId, tenantId, 'skipped', counters, startedAt, null, `connection_${connection.state}`);
        return;
      }

      // ── 4. Load enabled mappings — get project keys ────────────────────
      const mappings = await this.loadEnabledMappings(tenantId, connectionId);
      if (mappings.length === 0) {
        await this.closeRunRecord(runId, tenantId, 'skipped', counters, startedAt, null, 'no_enabled_mappings');
        return;
      }

      const projectKeys = mappings.map((m) => m.projectKey);
      const effectiveLookback = connection.reconcileLookbackHours ?? lookbackHours;

      // ── 5. Paginate Jira search ────────────────────────────────────────
      const { jql, fields, maxResults } = buildReconciliationJql({
        projectKeys,
        lookbackHours: effectiveLookback,
      });

      if (!jql) {
        await this.closeRunRecord(runId, tenantId, 'skipped', counters, startedAt, null, 'no_valid_project_keys');
        return;
      }

      // Load all active links for these projects for O(1) lookup
      const linksByIssueId = await this.loadActiveLinks(tenantId, projectKeys);

      let startAt = 0;
      let pageCount = 0;
      let truncated = false;
      let lastUpdatedAt: string | null = null;

      while (pageCount < RECON_MAX_PAGES) {
        // Rate-limit before each Jira call
        const rateResult = await this.rateLimiter.tryConsume(tenantId);
        if (!rateResult.allowed) {
          this.logger.warn('Rate limited during reconciliation — aborting run', {
            tenantId, retryAfterMs: rateResult.retryAfterMs,
          });
          outcome = 'rate_limited';
          await this.closeRunRecord(runId, tenantId, outcome, counters, startedAt, lastUpdatedAt, 'rate_limited');
          return;
        }

        let page: JiraSearchResponse;
        try {
          page = await this.searchJira(
            connection.siteUrl,
            connection.accessToken,
            jql,
            fields,
            maxResults,
            startAt,
          );
        } catch (err) {
          if (err instanceof JiraApiError && err.httpStatus === 429) {
            outcome = 'rate_limited';
          } else if (err instanceof JiraApiError && (err.httpStatus ?? 0) >= 500) {
            outcome = 'failed';
            errorMsg = err.message;
          } else if (err instanceof JiraApiError && err.httpStatus === 401) {
            // Mark connection degraded and skip
            await this.markConnectionDegraded(tenantId, connectionId);
            outcome = 'failed';
            errorMsg = 'auth_failure';
          } else {
            outcome = 'failed';
            errorMsg = (err as Error).message;
          }
          await this.closeRunRecord(runId, tenantId, outcome, counters, startedAt, lastUpdatedAt, errorMsg);
          return;
        }

        // Process each issue on this page
        for (const issue of page.issues) {
          counters.issuesScanned++;
          if (issue.fields.updated) lastUpdatedAt = issue.fields.updated;

          const cached = linksByIssueId.get(issue.id);
          if (!cached) continue; // No active link for this issue — not our concern

          const { hasDrift, driftedFields, syntheticEventId } = detectDrift(issue, cached);
          if (!hasDrift) continue;

          counters.driftDetected++;

          // Insert synthetic event (idempotent via ON CONFLICT DO NOTHING)
          const envelope = buildSyntheticEnvelope(issue, cached, driftedFields);
          const inserted = await this.insertSyntheticEvent(
            tenantId,
            syntheticEventId,
            envelope,
          );

          if (inserted) {
            counters.eventsSynthesised++;
            // Enqueue for inbound worker
            await this.enqueueSyntheticEvent(tenantId, syntheticEventId);
          }
          // If not inserted → already exists from a prior run (deduped by constraint)
        }

        pageCount++;
        const pageSize = page.issues.length;
        if (pageSize < maxResults) break; // Last page

        // Check if we've hit the page cap
        if (pageCount >= RECON_MAX_PAGES) {
          truncated = true;
          break;
        }

        startAt += pageSize;
      }

      // ── 6. Repair pending links ────────────────────────────────────────
      const pendingFixed = await this.repairPendingLinks(
        tenantId,
        connectionId,
        connection.siteUrl,
        connection.accessToken,
      );
      counters.pendingRepaired = pendingFixed;

      // ── 7. Update connection watermark ─────────────────────────────────
      const watermark = lastUpdatedAt ? new Date(lastUpdatedAt) : windowEnd;
      await this.updateConnectionWatermark(tenantId, connectionId, watermark);

      outcome = truncated ? 'truncated' : 'completed';
      await this.closeRunRecord(runId, tenantId, outcome, counters, startedAt, lastUpdatedAt, null);

      this.emitMetrics(tenantId, counters, outcome, Date.now() - startedAt);
    } catch (err: unknown) {
      errorMsg = (err as Error)?.message ?? 'unknown';
      this.logger.error('Reconciliation job threw unexpectedly', {
        tenantId, connectionId, error: errorMsg,
      });
      if (runId) {
        await this.closeRunRecord(runId, tenantId, 'failed', counters, startedAt, null, errorMsg);
      }
    }
  }

  // --------------------------------------------------------------------------
  // DB helpers
  // --------------------------------------------------------------------------

  private async openRunRecord(
    tenantId: string,
    connectionId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<string> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query(
        `SET LOCAL app.current_tenant = $1`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO jira_reconciliation_runs
           (id, tenant_id, connection_id, window_start, window_end, outcome)
         VALUES ($1, $2, $3, $4, $5, 'running')`,
        [id, tenantId, connectionId, windowStart.toISOString(), windowEnd.toISOString()],
      );
    } finally {
      client.release();
    }
    return id;
  }

  private async closeRunRecord(
    runId: string,
    tenantId: string,
    outcome: string,
    counters: RunCounters,
    startedAt: number,
    watermarkIso: string | null,
    error: string | null,
  ): Promise<void> {
    const durationMs = Date.now() - startedAt;
    const client = await this.pool.connect();
    try {
      await client.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);
      await client.query(
        `UPDATE jira_reconciliation_runs SET
           outcome           = $2,
           issues_scanned    = $3,
           drift_detected    = $4,
           events_synthesised = $5,
           pending_repaired  = $6,
           orphans_found     = $7,
           duration_ms       = $8,
           watermark         = $9,
           error             = $10
         WHERE id = $1`,
        [
          runId, outcome,
          counters.issuesScanned, counters.driftDetected,
          counters.eventsSynthesised, counters.pendingRepaired,
          counters.orphansFound, durationMs,
          watermarkIso ? new Date(watermarkIso).toISOString() : null,
          error,
        ],
      );
    } finally {
      client.release();
    }
  }

  /** Returns true when the advisory lock was acquired. */
  private async tryAdvisoryLock(connectionId: string): Promise<boolean> {
    // Use the first 8 bytes of the UUID as a bigint hash for pg_try_advisory_lock.
    const hex = connectionId.replace(/-/g, '').slice(0, 16);
    const lockKey = BigInt(`0x${hex}`);

    const client = await this.pool.connect();
    try {
      const result = await client.query<{ pg_try_advisory_lock: boolean }>(
        `SELECT pg_try_advisory_lock($1::bigint)`,
        [lockKey.toString()],
      );
      return result.rows[0]?.pg_try_advisory_lock === true;
    } finally {
      client.release();
    }
  }

  private async loadConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<{
    state: string;
    siteUrl: string;
    accessToken: string;
    reconcileLookbackHours: number;
  } | null> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);
      const result = await client.query<{
        state: string;
        site_url: string;
        access_token: string;
        reconcile_lookback_hours: number;
      }>(
        `SELECT jc.state, jc.site_url, jc.reconcile_lookback_hours,
                sm.secret_value AS access_token
         FROM jira_connections jc
         LEFT JOIN secrets_manager_cache sm ON sm.secret_ref = jc.secret_ref
         WHERE jc.id = $1 AND jc.tenant_id = $2`,
        [connectionId, tenantId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        state: row.state,
        siteUrl: row.site_url,
        accessToken: row.access_token ?? '',
        reconcileLookbackHours: row.reconcile_lookback_hours ?? RECON_LOOKBACK_DEFAULT_HOURS,
      };
    } finally {
      client.release();
    }
  }

  private async loadEnabledMappings(
    tenantId: string,
    connectionId: string,
  ): Promise<Array<{ projectKey: string; mappingId: string }>> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);
      const result = await client.query<{ project_key: string; id: string }>(
        `SELECT id, project_key FROM jira_project_mappings
         WHERE tenant_id = $1 AND connection_id = $2 AND enabled = true`,
        [tenantId, connectionId],
      );
      return result.rows.map((r) => ({ projectKey: r.project_key, mappingId: r.id }));
    } finally {
      client.release();
    }
  }

  private async loadActiveLinks(
    tenantId: string,
    projectKeys: string[],
  ): Promise<Map<string, CachedLinkState>> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);
      const result = await client.query<{
        id: string;
        ticket_id: string;
        tenant_id: string;
        connection_id: string;
        jira_issue_id: string;
        jira_issue_key: string;
        project_key: string;
        jira_status: string | null;
        jira_assignee: string | null;
        jira_updated_at: Date | null;
        link_state: string;
        mapping_id: string;
      }>(
        `SELECT id, ticket_id, tenant_id, connection_id, jira_issue_id,
                jira_issue_key, project_key, jira_status, jira_assignee,
                jira_updated_at, link_state, mapping_id
         FROM ticket_jira_links
         WHERE tenant_id = $1
           AND project_key = ANY($2)
           AND link_state = 'linked'
           AND jira_issue_id IS NOT NULL`,
        [tenantId, projectKeys],
      );

      const map = new Map<string, CachedLinkState>();
      for (const row of result.rows) {
        map.set(row.jira_issue_id, {
          linkId: row.id,
          ticketId: row.ticket_id,
          tenantId: row.tenant_id,
          connectionId: row.connection_id,
          jiraIssueId: row.jira_issue_id,
          jiraIssueKey: row.jira_issue_key,
          projectKey: row.project_key,
          jiraStatus: row.jira_status,
          jiraAssignee: row.jira_assignee,
          jiraUpdatedAt: row.jira_updated_at,
          linkState: row.link_state,
          mappingId: row.mapping_id,
        });
      }
      return map;
    } finally {
      client.release();
    }
  }

  private async insertSyntheticEvent(
    tenantId: string,
    syntheticEventId: string,
    envelope: ReturnType<typeof buildSyntheticEnvelope>,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);
      const result = await client.query(
        `INSERT INTO jira_webhook_events
           (id, tenant_id, jira_event_id, event_type, jira_issue_id, jira_issue_key,
            payload, signature_verified, processing_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'pending')
         ON CONFLICT (tenant_id, jira_event_id) DO NOTHING`,
        [
          randomUUID(), tenantId, syntheticEventId,
          envelope.eventType, envelope.jiraIssueId, envelope.jiraIssueKey,
          JSON.stringify(envelope.payload),
        ],
      );
      return (result.rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  private async enqueueSyntheticEvent(
    tenantId: string,
    webhookEventId: string,
  ): Promise<void> {
    if (!this.jiraSyncQueueUrl) return;

    const body = JSON.stringify({
      source: 'jira-webhook',
      tenantId,
      webhookEventId,
    });

    try {
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: this.jiraSyncQueueUrl,
          MessageBody: body,
        }),
      );
    } catch (err) {
      this.logger.warn('Failed to enqueue synthetic event', {
        tenantId, webhookEventId, error: (err as Error).message,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Pending link repair
  // --------------------------------------------------------------------------

  private async repairPendingLinks(
    tenantId: string,
    connectionId: string,
    siteUrl: string,
    accessToken: string,
  ): Promise<number> {
    const staleThreshold = new Date(Date.now() - PENDING_REPAIR_AGE_MINUTES * 60_000);

    const client = await this.pool.connect();
    let repairedCount = 0;

    try {
      await client.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);
      const result = await client.query<{
        id: string;
        ticket_id: string;
        jira_issue_id: string | null;
        project_key: string;
        reemit_count: number;
      }>(
        `SELECT id, ticket_id, jira_issue_id, project_key,
                COALESCE(reemit_count, 0) AS reemit_count
         FROM ticket_jira_links
         WHERE tenant_id = $1 AND connection_id = $2
           AND link_state = 'pending'
           AND created_at < $3`,
        [tenantId, connectionId, staleThreshold.toISOString()],
      );

      for (const link of result.rows) {
        // Consume one rate-limit token per probe
        const rateResult = await this.rateLimiter.tryConsume(tenantId);
        if (!rateResult.allowed) break; // Stop repair if rate limited

        // Search for the issue by idempotency label
        let foundIssue: JiraSearchIssue | null = null;
        try {
          foundIssue = await this.probeForIssue(
            siteUrl,
            accessToken,
            link.project_key,
            link.ticket_id,
          );
        } catch (err) {
          if (err instanceof JiraApiError && err.httpStatus === 404) {
            // Issue does not exist → treat as not found
          } else {
            continue; // Transient error — skip this link
          }
        }

        const decision = decidePendingRepair(foundIssue, link.reemit_count ?? 0);

        if (decision.action === 'repair' && foundIssue) {
          await client.query(
            `UPDATE ticket_jira_links SET
               link_state = 'linked',
               jira_issue_id = $3,
               jira_issue_key = $4,
               last_synced_at = now(),
               updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [link.id, tenantId, decision.jiraIssueId, decision.jiraIssueKey],
          );
          repairedCount++;
        } else if (decision.action === 'reemit') {
          await this.reemitOutboundEvent(tenantId, link.id);
          await client.query(
            `UPDATE ticket_jira_links SET reemit_count = COALESCE(reemit_count, 0) + 1
             WHERE id = $1 AND tenant_id = $2`,
            [link.id, tenantId],
          );
        } else if (decision.action === 'fail') {
          await client.query(
            `UPDATE ticket_jira_links SET
               link_state = 'failed',
               error_code = 'PENDING_UNRESOLVABLE',
               error_message = 'Reconciliation could not resolve pending link after repair attempt',
               updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [link.id, tenantId],
          );
        }
      }
    } finally {
      client.release();
    }

    return repairedCount;
  }

  private async probeForIssue(
    siteUrl: string,
    accessToken: string,
    projectKey: string,
    ticketId: string,
  ): Promise<JiraSearchIssue | null> {
    const label = encodeURIComponent(`opsninja:${ticketId}`);
    const sanitizedKey = projectKey.replace(/"/g, '');
    const jql = `project = "${sanitizedKey}" AND labels = "${label}"`;
    const url = `${siteUrl.replace(/\/$/, '')}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=1&fields=status,assignee,updated,summary`;

    try {
      const resp = await (this.jiraOps as unknown as {
        getJson: <T>(url: string, token: string) => Promise<T>;
      }).getJson<JiraSearchResponse>(url, accessToken);
      return resp.issues?.[0] ?? null;
    } catch {
      return null;
    }
  }

  private async reemitOutboundEvent(tenantId: string, linkId: string): Promise<void> {
    if (!this.jiraSyncQueueUrl) return;
    const body = JSON.stringify({
      source: 'jira-outbound',
      tenantId,
      linkId,
      eventType: 'create',
    });
    try {
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: this.jiraSyncQueueUrl,
          MessageBody: body,
        }),
      );
    } catch (err) {
      this.logger.warn('Failed to re-emit outbound event for pending repair', {
        tenantId, linkId, error: (err as Error).message,
      });
    }
  }

  private async markConnectionDegraded(tenantId: string, connectionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);
      await client.query(
        `UPDATE jira_connections SET state = 'degraded', updated_at = now()
         WHERE id = $1 AND tenant_id = $2 AND state = 'active'`,
        [connectionId, tenantId],
      );
    } finally {
      client.release();
    }
  }

  private async updateConnectionWatermark(
    tenantId: string,
    connectionId: string,
    watermark: Date,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);
      await client.query(
        `UPDATE jira_connections
         SET reconciliation_watermark = $3, updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [connectionId, tenantId, watermark.toISOString()],
      );
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Jira search API
  // --------------------------------------------------------------------------

  private async searchJira(
    siteUrl: string,
    accessToken: string,
    jql: string,
    fields: string[],
    maxResults: number,
    startAt: number,
  ): Promise<JiraSearchResponse> {
    const url = `${siteUrl.replace(/\/$/, '')}/rest/api/3/search`;
    const body = JSON.stringify({ jql, fields, maxResults, startAt });

    // Use a direct fetch rather than jiraOps (which has opinion about endpoint shape)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
    } catch {
      clearTimeout(timeout);
      throw new JiraApiError(
        { kind: 'transient', code: 'JIRA_UNREACHABLE', message: 'Jira search unreachable' },
        null, '', null,
      );
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const retryAfter = response.headers.get('Retry-After');
      const classification = classifyJiraError(response.status, retryAfter);
      throw new JiraApiError(classification, response.status, text, retryAfter);
    }

    const text = await response.text();
    return JSON.parse(text) as JiraSearchResponse;
  }

  // --------------------------------------------------------------------------
  // Metrics
  // --------------------------------------------------------------------------

  private emitMetrics(
    tenantId: string,
    counters: RunCounters,
    outcome: string,
    durationMs: number,
  ): void {
    this.logger.log('jira_recon_run', {
      metric: 'jira_recon_runs',
      tenantId,
      outcome,
      issuesScanned: counters.issuesScanned,
      driftDetected: counters.driftDetected,
      eventsSynthesised: counters.eventsSynthesised,
      pendingRepaired: counters.pendingRepaired,
      orphansFound: counters.orphansFound,
      durationMs,
    });

    if (outcome === 'failed') {
      this.logger.warn('jira_recon_failure', { metric: 'jira_recon_failures', tenantId });
    }
    if (counters.orphansFound > 0) {
      this.logger.warn('jira_recon_orphans', {
        metric: 'jira_recon_orphans',
        tenantId,
        count: counters.orphansFound,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Re-export types for SQS routing
// ---------------------------------------------------------------------------
export { JiraSearchIssue, CachedLinkState };
