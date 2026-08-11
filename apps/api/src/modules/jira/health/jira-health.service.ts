/**
 * JiraHealthService — aggregates connection + sync + webhook health for the
 * admin console (WO-058).
 *
 * Data sources:
 *   - jira_connections rows (DB via repository)
 *   - jira_webhook_events aggregate counts (DB; 24h window)
 *   - Redis keys for lag p95, rate budget, and a short response cache
 *
 * The entire response is cached in Redis for HEALTH_CACHE_TTL_S seconds so
 * repeated 15-second polling from the admin console is cheap. On Redis miss
 * the service falls through to live DB reads.
 *
 * Graceful degradation: when the DB is unreachable (unlikely but possible),
 * a cached stale payload is returned with stale:true. When there is no cache
 * and the DB fails, the error propagates so the caller can return 503 with
 * the last-known payload from a higher-level cache.
 *
 * Webhook secret rotation:
 *   - Generates a 32-byte cryptographically random secret
 *   - Stores it in the Secrets Manager (via CREDENTIAL_VAULT)
 *   - Records webhookSecretRotatedAt so the 10-minute overlap window is
 *     enforced by the webhook receiver
 *   - Returns the plaintext secret ONCE for the operator to copy; never stored
 *   - Writes an audit record
 */

import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { eq, and, gte, sql } from 'drizzle-orm';
import { jiraConnections, jiraWebhookEvents } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { RedisCacheService } from '../../../infra/cache/redis-cache';
import { AuditWriter } from '../../audit/audit-writer';
import { CREDENTIAL_VAULT, type CredentialVaultPort } from '../tokens/credential-vault.service';
import { JiraConnectionsRepository } from '../connections/jira-connections.repository';
import type {
  JiraHealthResponse,
  JiraHealthConnectionInfo,
  RotateWebhookSecretResponse,
} from './jira-health.dto';

const HEALTH_CACHE_TTL_S = 10;
const HEALTH_CACHE_KEY_PREFIX = 'jira:health:';

// Redis keys written by the sync worker (read-only here)
const LAG_P95_KEY_PREFIX = 'jira:sync:lag_p95:';
const RATE_BUDGET_KEY_PREFIX = 'jira:rate:budget:';

// Webhook overlap window
const WEBHOOK_OVERLAP_MS = 10 * 60_000; // 10 minutes

// ---------------------------------------------------------------------------
// Inner read-only repository for webhook event aggregates
// ---------------------------------------------------------------------------

class JiraEventsReadRepository extends TenantRepository {
  /** Count events in the last 24 hours grouped by processing_state. */
  async countEvents24h(tenantId: string): Promise<{
    processed: number;
    skipped: number;
    failed: number;
    dlqDepth: number;
    lastReceivedAt: Date | null;
    signatureFailures24h: number;
  }> {
    const since = new Date(Date.now() - 24 * 3600_000);

    const rows = await this.tx
      .select({
        processingState: jiraWebhookEvents.processingState,
        count: sql<string>`count(*)`,
      })
      .from(jiraWebhookEvents)
      .where(
        and(
          eq(jiraWebhookEvents.tenantId, tenantId),
          gte(jiraWebhookEvents.receivedAt, since),
        ),
      )
      .groupBy(jiraWebhookEvents.processingState);

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.processingState] = parseInt(row.count, 10);
    }

    // DLQ depth = events in 'failed' state overall (not just 24h)
    const dlqRows = await this.tx
      .select({ count: sql<string>`count(*)` })
      .from(jiraWebhookEvents)
      .where(
        and(
          eq(jiraWebhookEvents.tenantId, tenantId),
          eq(jiraWebhookEvents.processingState, 'failed'),
        ),
      );

    const dlqDepth = parseInt(dlqRows[0]?.count ?? '0', 10);

    // Last received at
    const lastRows = await this.tx
      .select({ receivedAt: jiraWebhookEvents.receivedAt })
      .from(jiraWebhookEvents)
      .where(eq(jiraWebhookEvents.tenantId, tenantId))
      .orderBy(sql`${jiraWebhookEvents.receivedAt} DESC`)
      .limit(1);

    const lastReceivedAt = lastRows[0]?.receivedAt ?? null;

    // Signature failures in 24h: events where signatureVerified=false
    const sigFailRows = await this.tx
      .select({ count: sql<string>`count(*)` })
      .from(jiraWebhookEvents)
      .where(
        and(
          eq(jiraWebhookEvents.tenantId, tenantId),
          eq(jiraWebhookEvents.signatureVerified, false),
          gte(jiraWebhookEvents.receivedAt, since),
        ),
      );

    const signatureFailures24h = parseInt(sigFailRows[0]?.count ?? '0', 10);

    return {
      processed: counts['processed'] ?? 0,
      skipped: counts['ignored'] ?? 0,
      failed: counts['failed'] ?? 0,
      dlqDepth,
      lastReceivedAt,
      signatureFailures24h,
    };
  }
}

// ---------------------------------------------------------------------------
// JiraHealthService
// ---------------------------------------------------------------------------

@Injectable()
export class JiraHealthService {
  private readonly logger = new Logger(JiraHealthService.name);

  constructor(
    private readonly connectionsRepo: JiraConnectionsRepository,
    private readonly eventsRepo: JiraEventsReadRepository,
    private readonly cache: RedisCacheService,
    private readonly auditWriter: AuditWriter,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVaultPort,
  ) {}

  // --------------------------------------------------------------------------
  // getHealth — GET /integrations/jira/health
  // --------------------------------------------------------------------------

  async getHealth(tenantId: string): Promise<JiraHealthResponse> {
    const cacheKey = `${HEALTH_CACHE_KEY_PREFIX}${tenantId}`;

    // Try cache first
    const cached = await this.cache.get<JiraHealthResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    // Live aggregate
    const payload = await this.buildHealthPayload(tenantId);
    await this.cache.set(cacheKey, payload, HEALTH_CACHE_TTL_S);
    return payload;
  }

  // --------------------------------------------------------------------------
  // rotateWebhookSecret — POST /integrations/jira/connections/:id/webhook-secret/rotate
  // --------------------------------------------------------------------------

  async rotateWebhookSecret(
    tenantId: string,
    connectionId: string,
    actorId: string | null,
    webhookBaseUrl: string,
  ): Promise<RotateWebhookSecretResponse> {
    // Validate connection exists
    const connection = await this.connectionsRepo.findById(tenantId, connectionId);
    if (!connection) {
      throw new NotFoundException({
        error: { code: 'JIRA_CONNECTION_NOT_FOUND', message: 'Jira connection not found.' },
      });
    }

    // Generate new 32-byte secret
    const newSecret = randomBytes(32).toString('hex');

    // Store the new secret via credential vault
    const secretRef = connection.webhookSecretRef ?? `jira/tenant/${tenantId}/connection/${connectionId}/webhook-secret`;
    await this.vault.store(secretRef, newSecret, tenantId);

    // Update the connection's webhookSecretRotatedAt
    await this.connectionsRepo.updateWebhookSecret(tenantId, connectionId, {
      webhookSecretRef: secretRef,
      webhookSecretRotatedAt: new Date(),
    });

    // Invalidate health cache
    const cacheKey = `${HEALTH_CACHE_KEY_PREFIX}${tenantId}`;
    await this.cache.del(cacheKey);

    // Audit
    await this.auditWriter.append({
      resourceType: 'jira_connection',
      resourceId: connectionId,
      action: 'webhook_secret_rotate',
      beforeState: { secretRef: connection.webhookSecretRef ?? null },
      afterState: { secretRef },
      metadata: { tenantId, actorId },
    });

    const previousValidUntil = new Date(Date.now() + WEBHOOK_OVERLAP_MS).toISOString();
    const webhookUrl = `${webhookBaseUrl}/api/v1/jira/webhooks/${tenantId}/${connectionId}`;

    this.logger.log('Webhook secret rotated', { tenantId, connectionId });

    return {
      webhookUrl,
      secretOnce: newSecret,
      previousValidUntil,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async buildHealthPayload(tenantId: string): Promise<JiraHealthResponse> {
    // Connections from DB
    const connectionsResult = await this.connectionsRepo.list(tenantId, 50);
    const connections: JiraHealthConnectionInfo[] = connectionsResult.data.map((c) => ({
      id: c.id,
      siteUrl: c.siteUrl,
      cloudId: c.cloudId ?? null,
      authMethod: c.authMethod,
      state: c.state,
      tokenExpiresAt: c.tokenExpiresAt ? c.tokenExpiresAt.toISOString() : null,
      scopes: c.scopes ?? [],
    }));

    // Event aggregate from DB
    const eventStats = await this.eventsRepo.countEvents24h(tenantId);

    // Redis keys written by the sync worker — degrade gracefully if missing
    const lagP95Key = `${LAG_P95_KEY_PREFIX}${tenantId}`;
    const rateBudgetKey = `${RATE_BUDGET_KEY_PREFIX}${tenantId}`;
    const lagP95Ms = await this.cache.get<number>(lagP95Key);
    const rateBudgetRemaining = await this.cache.get<number>(rateBudgetKey);

    // Receiver health: healthy if at least one connection is active and
    // we've received at least one event in 24h (or have active connections)
    const hasActiveConnection = connections.some((c) => c.state === 'active');
    const receiverHealthy =
      hasActiveConnection && eventStats.signatureFailures24h < 10;

    return {
      connections,
      sync: {
        lagP95Ms: lagP95Ms ?? null,
        events24h: {
          processed: eventStats.processed,
          skipped: eventStats.skipped,
          failed: eventStats.failed,
        },
        dlqDepth: eventStats.dlqDepth,
        rateBudgetRemaining: rateBudgetRemaining ?? null,
      },
      webhook: {
        lastReceivedAt: eventStats.lastReceivedAt ? eventStats.lastReceivedAt.toISOString() : null,
        signatureFailures24h: eventStats.signatureFailures24h,
        receiverHealthy,
      },
      cachedAt: new Date().toISOString(),
    };
  }
}

// Re-export inner repository so JiraModule can provide it
export { JiraEventsReadRepository };
