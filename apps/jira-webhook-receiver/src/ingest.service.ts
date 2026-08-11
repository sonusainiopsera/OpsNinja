/**
 * IngestService — core pipeline for the Jira webhook receiver.
 *
 * Responsibilities (all within one DB transaction):
 *  1. Resolve tenant by slug.
 *  2. Resolve Jira connection by cloudId; cross-check against the slug's tenant.
 *  3. Fetch the HMAC signing secret from the vault (Redis-cached).
 *  4. Persist the raw envelope to jira_webhook_events.
 *  5. On unique-constraint conflict → return { deduped: true } without re-enqueuing.
 *  6. On first insert → write an outbox_events row so the sync worker picks it up.
 *
 * This service NEVER makes outbound HTTP calls. Its budget is:
 *   one Postgres read (tenant/connection), one INSERT, one INSERT, one Redis GET/SET.
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import type { PoolClient } from 'pg';
import { pool, createTransactionHandle } from '@opsninja/db';
import { jiraWebhookEvents } from '@opsninja/db';
import { REDIS_CLIENT } from './redis.provider';
import { CREDENTIAL_VAULT, type CredentialVaultPort } from './credential-vault.port';

export interface JiraWebhookPayload {
  id?: number | string;
  webhookEvent?: string;
  timestamp?: number;
  matchedWebhookIds?: number[];
  issue?: { id?: string; key?: string };
  comment?: { id?: string };
}

export interface IngestResult {
  deduped: boolean;
  tenantId: string;
  jiraEventId: string;
}

export interface ResolvedConnection {
  tenantId: string;
  connectionId: string;
  secret: string;
  previousSecret: string | undefined;
}

const SECRET_CACHE_TTL = 300; // 5 minutes
const KNOWN_TYPES = new Set([
  'jira:issue_updated', 'jira:issue_created', 'jira:issue_deleted',
  'comment_created', 'comment_updated', 'comment_deleted',
]);

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVaultPort,
  ) {}

  /**
   * Resolve tenant + connection + webhook secret for the given slug and cloudId.
   * Returns null when the tenant slug is unknown (existence non-disclosure).
   */
  async resolveConnection(
    tenantSlug: string,
    cloudId: string | undefined,
  ): Promise<ResolvedConnection | null> {
    const cacheKey = `jira:webhook-conn:${tenantSlug}:${cloudId ?? '_'}`;
    const hit = await this.redis.get(cacheKey);
    if (hit) {
      try { return JSON.parse(hit) as ResolvedConnection; } catch { /* re-fetch */ }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');

      const tenantRes = await client.query<{ id: string }>(
        `SELECT id FROM tenants WHERE slug = $1 AND active = true LIMIT 1`,
        [tenantSlug],
      );
      if (!tenantRes.rows[0]) {
        await client.query('ROLLBACK');
        this.logger.warn('webhook:unresolvable_tenant', { tenantSlug, metric: 'jira_webhook_unresolvable_tenant' });
        return null;
      }
      const tenantId = tenantRes.rows[0].id;

      const connSql = cloudId
        ? `SELECT id, webhook_secret_ref, webhook_secret_rotated_at
           FROM jira_connections WHERE tenant_id=$1 AND cloud_id=$2 AND state!='revoked' LIMIT 1`
        : `SELECT id, webhook_secret_ref, webhook_secret_rotated_at
           FROM jira_connections WHERE tenant_id=$1 AND state!='revoked' LIMIT 1`;
      const connRes = await client.query<{
        id: string;
        webhook_secret_ref: string | null;
        webhook_secret_rotated_at: Date | null;
      }>(connSql, cloudId ? [tenantId, cloudId] : [tenantId]);

      await client.query('ROLLBACK');

      if (!connRes.rows[0] || !connRes.rows[0].webhook_secret_ref) {
        this.logger.warn('webhook:no_connection', { tenantSlug, cloudId });
        return null;
      }
      const conn = connRes.rows[0];
      const secret = await this.vault.retrieve(conn.webhook_secret_ref, tenantId);

      let previousSecret: string | undefined;
      if (conn.webhook_secret_rotated_at) {
        const ageMs = Date.now() - new Date(conn.webhook_secret_rotated_at).getTime();
        if (ageMs < 10 * 60 * 1000) {
          try {
            previousSecret = await this.vault.retrieve(`${conn.webhook_secret_ref}:prev`, tenantId);
          } catch { /* previous secret already deleted */ }
        }
      }

      const result: ResolvedConnection = { tenantId, connectionId: conn.id, secret, previousSecret };
      await this.redis.setex(cacheKey, SECRET_CACHE_TTL, JSON.stringify(result));
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Persist the webhook envelope and enqueue via outbox — all in one transaction.
   * Returns { deduped: true } if the (tenant_id, jira_event_id) already exists.
   */
  async ingest(
    tenantId: string,
    connectionId: string,
    parsedPayload: JiraWebhookPayload,
  ): Promise<IngestResult> {
    const jiraEventId = String(
      parsedPayload.id ??
      `${parsedPayload.webhookEvent ?? 'unknown'}-${parsedPayload.timestamp ?? Date.now()}`,
    );
    const eventType = parsedPayload.webhookEvent ?? 'unknown';
    const jiraIssueId = parsedPayload.issue?.id;
    const jiraIssueKey = parsedPayload.issue?.key;
    const processingState = KNOWN_TYPES.has(eventType) ? 'pending' : 'ignored';

    if (processingState === 'ignored') {
      this.logger.warn('webhook:ignored_type', { tenantId, eventType, jiraEventId, metric: 'jira_webhook_ignored_type' });
    }

    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const tx = createTransactionHandle(client);

      // ── Insert envelope ──────────────────────────────────────────────────
      let deduped = false;
      try {
        await tx.insert(jiraWebhookEvents).values({
          tenantId,
          jiraEventId,
          eventType,
          jiraIssueId: jiraIssueId ?? undefined,
          jiraIssueKey: jiraIssueKey ?? undefined,
          payload: parsedPayload as Record<string, unknown>,
          signatureVerified: true,
          processingState,
        });
      } catch (err: unknown) {
        if (isUniqueViolation(err)) {
          deduped = true;
        } else {
          throw err;
        }
      }

      // ── Enqueue via raw SQL outbox insert (avoids circular schema import) ─
      if (!deduped && processingState === 'pending') {
        await client.query(
          `INSERT INTO outbox_events
             (tenant_id, aggregate_type, aggregate_id, event_type, payload, status)
           VALUES ($1, 'jira_webhook', $2::uuid, $3, $4::jsonb, 'pending')`,
          [
            tenantId,
            connectionId,
            eventType,
            JSON.stringify({ jiraEventId, jiraIssueId: jiraIssueId ?? null, jiraIssueKey: jiraIssueKey ?? null }),
          ],
        );
      }

      await client.query('COMMIT');

      this.logger.log('webhook:received', {
        tenantId, jiraEventId, eventType, deduped,
        metric: 'jira_webhook_received',
      });
      return { deduped, tenantId, jiraEventId };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
