/**
 * DTOs for the Jira integration health aggregated endpoint — WO-058.
 *
 * GET /api/v1/integrations/jira/health
 * POST /api/v1/integrations/jira/connections/:id/webhook-secret/rotate
 */

// ---------------------------------------------------------------------------
// Health response
// ---------------------------------------------------------------------------

export interface JiraHealthConnectionInfo {
  id: string;
  siteUrl: string;
  cloudId: string | null;
  authMethod: string;
  state: string;
  tokenExpiresAt: string | null;
  scopes: string[];
}

export interface JiraHealthSyncInfo {
  lagP95Ms: number | null;
  events24h: {
    processed: number;
    skipped: number;
    failed: number;
  };
  dlqDepth: number;
  rateBudgetRemaining: number | null;
}

export interface JiraHealthWebhookInfo {
  lastReceivedAt: string | null;
  signatureFailures24h: number;
  receiverHealthy: boolean;
}

export interface JiraHealthResponse {
  connections: JiraHealthConnectionInfo[];
  sync: JiraHealthSyncInfo;
  webhook: JiraHealthWebhookInfo;
  cachedAt: string;
  stale?: boolean;
}

// ---------------------------------------------------------------------------
// Webhook secret rotation response
// ---------------------------------------------------------------------------

export interface RotateWebhookSecretResponse {
  webhookUrl: string;
  secretOnce: string;
  previousValidUntil: string;
}
