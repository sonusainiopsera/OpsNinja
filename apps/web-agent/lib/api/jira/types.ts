/**
 * Jira integration API types — WO-058.
 *
 * These mirror the server DTOs so client and server shapes cannot silently drift.
 */

// ---------------------------------------------------------------------------
// Health endpoint
// ---------------------------------------------------------------------------

export interface JiraHealthConnectionInfo {
  id: string;
  siteUrl: string;
  cloudId: string | null;
  authMethod: string;
  state: 'pending' | 'active' | 'degraded' | 'revoked';
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
// Webhook secret rotation
// ---------------------------------------------------------------------------

export interface RotateWebhookSecretResponse {
  webhookUrl: string;
  secretOnce: string;
  previousValidUntil: string;
}

// ---------------------------------------------------------------------------
// Connections (from WO-051/052 — consumed read-only by console)
// ---------------------------------------------------------------------------

export interface JiraConnection {
  id: string;
  siteUrl: string;
  cloudId: string | null;
  authMethod: string;
  scopes: string[];
  secretRef: string | null;
  tokenExpiresAt: string | null;
  state: string;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JiraConnectionResponse {
  data: JiraConnection;
}

export interface TestConnectionResult {
  reachable: boolean;
  latencyMs: number;
  serverInfo: { serverTitle: string; version: string; deploymentType: string } | null;
  error: string | null;
}

export interface TestConnectionResponse {
  data: TestConnectionResult;
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

export interface FieldMapEntry {
  source: { type: 'ticket_field' | 'static'; fieldKey?: string; staticValue?: string };
  target: { fieldId: string; fieldName: string };
}

export interface StatusMapEntry {
  opsninjaStatus: string;
  jiraStatusId: string;
  jiraStatusName: string;
}

export interface SyncRules {
  syncComments: boolean;
  syncStatusChanges: boolean;
  commentVisibility: 'public' | 'internal' | 'both';
}

export interface JiraProjectMapping {
  id: string;
  connectionId: string;
  projectKey: string;
  projectId: string;
  defaultIssueTypeId: string;
  fieldMap: FieldMapEntry[];
  statusMap: StatusMapEntry[];
  syncRules: SyncRules;
  isDefault: boolean;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** version token for optimistic concurrency (updatedAt-based) */
  version?: string;
}

export interface PaginatedMappingsResponse {
  data: JiraProjectMapping[];
  nextCursor: string | null;
}

export interface MappingResponse {
  data: JiraProjectMapping;
}

// ---------------------------------------------------------------------------
// Discovery endpoints (projects, issue types, fields)
// ---------------------------------------------------------------------------

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrl: string | null;
  issueTypes: JiraIssueType[];
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl: string | null;
  subtask: boolean;
}

export interface JiraField {
  id: string;
  name: string;
  required: boolean;
  schema: { type: string; items?: string } | null;
  allowedValues: { id: string; name: string }[] | null;
}

export interface JiraProjectsResponse {
  data: JiraProject[];
}

export interface JiraFieldsResponse {
  data: JiraField[];
}

// ---------------------------------------------------------------------------
// DLQ
// ---------------------------------------------------------------------------

export interface DlqItem {
  id: string;
  tenantId: string;
  jiraEventId: string;
  eventType: string;
  jiraIssueKey: string | null;
  attempts: number;
  lastError: string | null;
  receivedAt: string;
  processingState: string;
}

export interface DlqPageResponse {
  data: DlqItem[];
  nextCursor: string | null;
  total: number;
}

export interface ReplayResult {
  id: string;
  success: boolean;
  error: string | null;
}

export interface BatchReplayResponse {
  results: ReplayResult[];
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type ReconciliationOutcome = 'completed' | 'failed' | 'running' | 'partial';

export interface ReconciliationRun {
  id: string;
  tenantId: string;
  connectionId: string;
  lookbackHours: number;
  startedAt: string;
  completedAt: string | null;
  outcome: ReconciliationOutcome;
  ticketsChecked: number;
  ticketsResynced: number;
  errorsCount: number;
  triggeredBy: string | null;
}

export interface ReconciliationRunsResponse {
  data: ReconciliationRun[];
  nextCursor: string | null;
}

export interface TriggerReconciliationResponse {
  data: ReconciliationRun;
  auditId: string;
}

// ---------------------------------------------------------------------------
// Audit entry (surfaced on write success)
// ---------------------------------------------------------------------------

export interface AuditEntryRef {
  auditId: string;
  recordedAt: string;
}
