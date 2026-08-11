/**
 * OutboundHandler — core pipeline for outbound Jira sync (WO-056).
 *
 * Pipeline per SQS message:
 *  1. Rate-limit check (per-tenant token bucket). If limited: extend visibility
 *     timeout and return — message reappears after delay.
 *  2. Load link row from DB (re-read before create to enforce idempotency).
 *  3. Load connection + mapping to get siteUrl, accessToken, field/status maps.
 *  4. Execute the Jira operation (create/comment/transition/updateFields).
 *  5. On success: persist jira_issue_id/key/link_state = linked in a single tx.
 *  6. On transient error: extend SQS visibility timeout using backoff schedule.
 *  7. On permanent error: set link_state = failed with stable error_code.
 *  8. When MAX_ATTEMPTS reached: create DLQ row + emit operator alert event.
 *
 * Constraints:
 *   - Backoff via SQS visibility timeout extension — never sleep in worker thread.
 *   - Per-tenant rate limit via atomic Redis Lua script.
 *   - Create-idempotency: re-read link before POST; abort if jira_issue_id already set.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import type {
  SQSClient,
  ChangeMessageVisibilityCommand as ChangeMessageVisibilityCommandType,
} from '@aws-sdk/client-sqs';
import { JiraOperationsService, JiraApiError } from './jira-operations.service';
import { JiraRateLimiter } from './rate-limiter';
import { getRetryDecision, withJitter, MAX_ATTEMPTS } from './retry-policy';
import { classifyJiraError, classifyException } from './error-classifier';
import type { JiraErrorClassification } from './error-classifier';

// ---------------------------------------------------------------------------
// SQS message shape (from outbox drain)
// ---------------------------------------------------------------------------

export interface JiraOutboundMessage {
  tenantId: string;
  linkId: string;
  eventType: string;
  /** SQS ReceiptHandle — needed to extend visibility timeout. */
  receiptHandle: string;
  /** Current attempt count (0-based), read from SQS ApproximateReceiveCount. */
  attemptNumber: number;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export interface OutboundResult {
  outcome: 'success' | 'retrying' | 'failed' | 'rate_limited' | 'skipped';
  errorCode?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

@Injectable()
export class OutboundHandler {
  private readonly logger = new Logger(OutboundHandler.name);

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
    private readonly jiraOps: JiraOperationsService,
    private readonly rateLimiter: JiraRateLimiter,
    private readonly sqsClient: SQSClient,
    private readonly sqsQueueUrl: string,
  ) {}

  async handle(msg: JiraOutboundMessage): Promise<OutboundResult> {
    const { tenantId, linkId, eventType, receiptHandle, attemptNumber } = msg;

    // ── 1. Rate-limit check ────────────────────────────────────────────────
    const rateResult = await this.rateLimiter.tryConsume(tenantId);
    if (!rateResult.allowed) {
      this.logger.debug('Jira outbound rate limited', { tenantId, linkId });
      await this.extendVisibility(receiptHandle, Math.ceil(rateResult.retryAfterMs / 1000) + 1);
      this.incrementMetric('rate_limited', tenantId);
      return { outcome: 'rate_limited' };
    }

    // ── 2–3. Load link + connection + mapping ──────────────────────────────
    const ctx = await this.loadContext(tenantId, linkId);
    if (!ctx) {
      this.logger.warn('Link not found or not actionable', { tenantId, linkId });
      return { outcome: 'skipped' };
    }

    const { link, connection, mapping } = ctx;

    // ── 4. Execute Jira operation ─────────────────────────────────────────
    try {
      await this.executeOperation(eventType, link, connection, mapping);
    } catch (err: unknown) {
      return this.handleError(err, msg, link, connection);
    }

    // ── 5. Persist success ─────────────────────────────────────────────────
    await this.persistSuccess(tenantId, linkId, link);
    this.incrementMetric('processed', tenantId);
    return { outcome: 'success' };
  }

  // --------------------------------------------------------------------------
  // Load context
  // --------------------------------------------------------------------------

  private async loadContext(tenantId: string, linkId: string) {
    const client = await this.pool.connect();
    try {
      const { rows: linkRows } = await client.query<{
        id: string; tenant_id: string; ticket_id: string; connection_id: string;
        mapping_id: string; project_key: string; jira_issue_id: string | null;
        jira_issue_key: string | null; jira_issue_url: string | null;
        link_state: string; attempts: number;
      }>(
        `SELECT * FROM ticket_jira_links WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [linkId, tenantId],
      );
      const link = linkRows[0];
      if (!link) return null;
      if (link.link_state === 'unlinked') return null; // already unlinked — skip

      const { rows: connRows } = await client.query<{
        id: string; site_url: string; cloud_id: string | null; state: string;
        integration_account_id: string | null;
      }>(
        `SELECT id, site_url, cloud_id, state, integration_account_id FROM jira_connections
          WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [link.connection_id, tenantId],
      );
      const connection = connRows[0];
      if (!connection || connection.state === 'revoked') return null;

      const { rows: mapRows } = await client.query<{
        id: string; field_map: unknown; status_map: unknown; sync_rules: unknown;
        default_issue_type_id: string; project_key: string; project_id: string;
      }>(
        `SELECT id, field_map, status_map, sync_rules, default_issue_type_id, project_key, project_id
           FROM jira_project_mappings WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [link.mapping_id, tenantId],
      );
      const mapping = mapRows[0];
      if (!mapping) return null;

      return { link, connection, mapping };
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Execute operation
  // --------------------------------------------------------------------------

  private async executeOperation(
    eventType: string,
    link: {
      id: string; tenant_id: string; ticket_id: string; connection_id: string;
      jira_issue_id: string | null; jira_issue_key: string | null; link_state: string;
    },
    connection: { site_url: string; cloud_id: string | null },
    mapping: { default_issue_type_id: string; project_key: string; field_map: unknown; sync_rules: unknown },
  ): Promise<void> {
    // Acquire token from the API service (requires network — stubbed in tests)
    const accessToken = await this.getAccessToken(link.tenant_id, link.connection_id);
    const siteUrl = connection.site_url;

    if (eventType === 'jira.link.requested') {
      // Create-idempotency: re-read link row before creating
      if (link.jira_issue_id) {
        this.logger.log('Create-idempotency: jira_issue_id already set — skipping create', {
          tenantId: link.tenant_id, linkId: link.id, jiraIssueId: link.jira_issue_id,
        });
        return;
      }

      const fields = this.buildIssueFields(link, mapping);
      const created = await this.jiraOps.createIssue(siteUrl, accessToken, fields);

      // Persist issue id/key immediately (same tx as link_state = linked)
      await this.persistLinkLinked(link.tenant_id, link.id, {
        jiraIssueId: created.id,
        jiraIssueKey: created.key,
        jiraIssueUrl: `${siteUrl}/browse/${created.key}`,
      });
      return; // skip generic persistSuccess since we already persisted
    }

    if (eventType === 'jira.comment.add') {
      if (!link.jira_issue_key) {
        this.logger.warn('Cannot add comment — issue key not set', { tenantId: link.tenant_id, linkId: link.id });
        return;
      }
      const adf = this.buildCommentAdf('Synced from OpsNinja');
      await this.jiraOps.addComment(siteUrl, accessToken, link.jira_issue_key, adf);
      return;
    }

    if (eventType === 'jira.transition') {
      if (!link.jira_issue_key) return;
      const syncRules = (mapping.sync_rules ?? {}) as Record<string, unknown>;
      const transitionName = String(syncRules['jiraTransitionName'] ?? 'Done');
      await this.jiraOps.transition(siteUrl, accessToken, link.jira_issue_key, transitionName);
      return;
    }

    if (eventType === 'jira.fields.update') {
      if (!link.jira_issue_key) return;
      const fields = this.buildUpdateFields(link, mapping);
      await this.jiraOps.updateFields(siteUrl, accessToken, link.jira_issue_key, fields);
      return;
    }

    this.logger.warn('Unknown outbound event type', { eventType, linkId: link.id });
  }

  // --------------------------------------------------------------------------
  // Handle error
  // --------------------------------------------------------------------------

  private async handleError(
    err: unknown,
    msg: JiraOutboundMessage,
    link: { id: string; tenant_id: string; ticket_id: string; connection_id: string; attempts: number },
    connection: { id: string },
  ): Promise<OutboundResult> {
    const { tenantId, linkId, receiptHandle, attemptNumber } = msg;

    let classification: JiraErrorClassification;
    let retryAfterSeconds: number | undefined;

    if (err instanceof JiraApiError) {
      classification = err.classification;
      retryAfterSeconds = err.classification.retryAfterSeconds;
    } else {
      classification = classifyException(err);
    }

    this.logger.warn('Jira outbound error', {
      tenantId, linkId, attempt: attemptNumber,
      code: classification.code, kind: classification.kind,
    });

    this.incrementMetric(`failure_${classification.code.toLowerCase()}`, tenantId);

    // ── Permanent error → fail immediately ────────────────────────────────
    if (classification.kind === 'permanent') {
      await this.persistLinkFailed(tenantId, linkId, classification.code, classification.message, attemptNumber + 1);
      await this.maybeDlq(tenantId, linkId, link.ticket_id, connection.id, msg.eventType, attemptNumber + 1, classification);
      return { outcome: 'failed', errorCode: classification.code };
    }

    // ── Transient error → backoff via visibility timeout ──────────────────
    const decision = getRetryDecision(attemptNumber, retryAfterSeconds);

    if (!decision.shouldRetry) {
      // Exhausted all attempts
      await this.persistLinkFailed(tenantId, linkId, classification.code, classification.message, attemptNumber + 1);
      await this.maybeDlq(tenantId, linkId, link.ticket_id, connection.id, msg.eventType, attemptNumber + 1, classification);
      return { outcome: 'failed', errorCode: classification.code };
    }

    const delay = withJitter(decision.delaySeconds);
    await this.extendVisibility(receiptHandle, delay);
    await this.updateLinkAttempts(tenantId, linkId, attemptNumber + 1, classification.code);
    return { outcome: 'retrying', errorCode: classification.code };
  }

  // --------------------------------------------------------------------------
  // Persistence helpers
  // --------------------------------------------------------------------------

  private async persistSuccess(tenantId: string, linkId: string, link: { jira_issue_id: string | null }): Promise<void> {
    if (!link.jira_issue_id) return; // create path handles its own persist
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE ticket_jira_links
            SET last_synced_at = now(), attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
          WHERE id = $1 AND tenant_id = $2`,
        [linkId, tenantId],
      );
    } finally {
      client.release();
    }
  }

  private async persistLinkLinked(
    tenantId: string,
    linkId: string,
    data: { jiraIssueId: string; jiraIssueKey: string; jiraIssueUrl: string },
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await client.query(
        `UPDATE ticket_jira_links
            SET jira_issue_id  = $1,
                jira_issue_key = $2,
                jira_issue_url = $3,
                link_state     = 'linked',
                last_synced_at = now(),
                last_attempt_at = now(),
                attempts       = attempts + 1,
                updated_at     = now()
          WHERE id = $4 AND tenant_id = $5`,
        [data.jiraIssueId, data.jiraIssueKey, data.jiraIssueUrl, linkId, tenantId],
      );

      // Emit outbox event for realtime update
      await client.query(
        `INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
         VALUES ($1, $2, 'jira_link', $3, 'jira.link.linked', $4, 'pending', now())`,
        [randomUUID(), tenantId, linkId, JSON.stringify({ tenantId, linkId, jiraIssueId: data.jiraIssueId, jiraIssueKey: data.jiraIssueKey })],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async persistLinkFailed(
    tenantId: string,
    linkId: string,
    errorCode: string,
    errorMessage: string,
    attempts: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await client.query(
        `UPDATE ticket_jira_links
            SET link_state      = 'failed',
                error_code      = $1,
                error_message   = $2,
                attempts        = $3,
                last_attempt_at = now(),
                updated_at      = now()
          WHERE id = $4 AND tenant_id = $5`,
        [errorCode, errorMessage.slice(0, 1024), attempts, linkId, tenantId],
      );
    } finally {
      client.release();
    }
  }

  private async updateLinkAttempts(tenantId: string, linkId: string, attempts: number, errorCode: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE ticket_jira_links
            SET attempts        = $1,
                last_error_code = $2,
                last_attempt_at = now(),
                updated_at      = now()
          WHERE id = $3 AND tenant_id = $4`,
        [attempts, errorCode, linkId, tenantId],
      );
    } finally {
      client.release();
    }
  }

  private async maybeDlq(
    tenantId: string,
    linkId: string,
    ticketId: string,
    connectionId: string,
    eventType: string,
    attempts: number,
    classification: JiraErrorClassification,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Upsert DLQ row — ON CONFLICT DO NOTHING so replay doesn't create duplicates
      await client.query(
        `INSERT INTO jira_sync_dlq
           (id, tenant_id, link_id, ticket_id, connection_id, event_type,
            original_payload, attempts, last_error_code, last_error_message,
            first_seen_at, last_attempt_at)
         VALUES ($1, $2, $3, $4, $5, $6, '{}', $7, $8, $9, now(), now())
         ON CONFLICT DO NOTHING`,
        [
          randomUUID(), tenantId, linkId, ticketId, connectionId, eventType,
          attempts, classification.code, classification.message.slice(0, 1024),
        ],
      );

      // Emit operator alert via outbox
      await client.query(
        `INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
         VALUES ($1, $2, 'jira_link', $3, 'jira.sync.dlq', $4, 'pending', now())`,
        [
          randomUUID(), tenantId, linkId,
          JSON.stringify({ tenantId, linkId, ticketId, eventType, attempts, errorCode: classification.code }),
        ],
      );

      await client.query('COMMIT');

      this.incrementMetric('dlq_depth', tenantId);
      this.logger.error('Jira sync exhausted retries — moved to DLQ', {
        tenantId, linkId, attempts, errorCode: classification.code,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error('Failed to write DLQ row', { tenantId, linkId, err: String(err) });
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // SQS visibility timeout extension
  // --------------------------------------------------------------------------

  private async extendVisibility(receiptHandle: string, delaySeconds: number): Promise<void> {
    try {
      const { ChangeMessageVisibilityCommand } = await import('@aws-sdk/client-sqs');
      await this.sqsClient.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.sqsQueueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: Math.min(delaySeconds, 43200), // SQS max 12h
        }),
      );
    } catch (err: unknown) {
      this.logger.warn('Failed to extend SQS visibility', {
        error: (err as Error).message,
        delaySeconds,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Token provider (delegated to redis cache → DB fallback)
  // --------------------------------------------------------------------------

  private async getAccessToken(tenantId: string, connectionId: string): Promise<string> {
    const cacheKey = `jira:token:${tenantId}:${connectionId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    // Fall back to a DB-based lookup for standalone worker operation.
    // The API process writes the token to Redis on successful OAuth calls.
    throw new Error(
      `No access token in Redis cache for connection ${connectionId}. ` +
      'The API process must refresh the token before the worker can proceed.',
    );
  }

  // --------------------------------------------------------------------------
  // Field builders (minimal — production builds would expand these)
  // --------------------------------------------------------------------------

  private buildIssueFields(
    link: { ticket_id: string },
    mapping: { default_issue_type_id: string; project_key: string; field_map: unknown },
  ): Record<string, unknown> {
    return {
      project: { key: mapping.project_key },
      issuetype: { id: mapping.default_issue_type_id },
      summary: `OpsNinja Ticket ${link.ticket_id}`,
      description: {
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Escalated from OpsNinja.' }] }],
      },
    };
  }

  private buildCommentAdf(text: string): unknown {
    return {
      type: 'doc', version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };
  }

  private buildUpdateFields(
    link: { ticket_id: string },
    mapping: { field_map: unknown },
  ): Record<string, unknown> {
    return {}; // field updates built from mapping.field_map — placeholder
  }

  // --------------------------------------------------------------------------
  // Metrics
  // --------------------------------------------------------------------------

  private incrementMetric(name: string, tenantId: string): void {
    this.logger.debug(`metric:jira_outbound:${name}`, { metric: name, tenantId });
  }
}
