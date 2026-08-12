/**
 * MSW handlers for the Jira Integration Console endpoints — WO-058.
 *
 * Exports fixtures so component tests can reference them directly.
 * Exports `resetJiraHandlers()` to allow per-test overrides.
 * Exports `jiraHandlers` to spread into the MSW server/worker.
 */

import { http, HttpResponse } from 'msw';
import type {
  JiraHealthResponse,
  JiraHealthConnectionInfo,
  RotateWebhookSecretResponse,
  JiraProjectsResponse,
  JiraFieldsResponse,
  PaginatedMappingsResponse,
  DlqPageResponse,
  ReconciliationRunsResponse,
  TriggerReconciliationResponse,
  BatchReplayResponse,
  ReplayResult,
  TestConnectionResponse,
} from '../../api/jira/types';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

export const FIXTURE_CONNECTION_ID = 'f0580001-0000-0000-0000-000000000001';
export const FIXTURE_CONNECTION_ID_2 = 'f0580001-0000-0000-0000-000000000002';
export const FIXTURE_MAPPING_ID = 'f0580002-0000-0000-0000-000000000001';
export const FIXTURE_DLQ_EVENT_1 = 'f0580003-0000-0000-0000-000000000001';
export const FIXTURE_DLQ_EVENT_2 = 'f0580003-0000-0000-0000-000000000002';
export const FIXTURE_RECON_RUN_1 = 'f0580004-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Connection fixtures
// ---------------------------------------------------------------------------

export const MOCK_CONNECTION_ACTIVE: JiraHealthConnectionInfo = {
  id: FIXTURE_CONNECTION_ID,
  siteUrl: 'https://acme.atlassian.net',
  cloudId: 'cloud-acme-001',
  authMethod: 'oauth3lo',
  state: 'active',
  tokenExpiresAt: '2026-09-01T00:00:00.000Z',
  scopes: ['read:jira-work', 'write:jira-work', 'manage:jira-webhook'],
};

export const MOCK_CONNECTION_DEGRADED: JiraHealthConnectionInfo = {
  ...MOCK_CONNECTION_ACTIVE,
  id: FIXTURE_CONNECTION_ID_2,
  siteUrl: 'https://beta.atlassian.net',
  cloudId: 'cloud-beta-001',
  state: 'degraded',
  tokenExpiresAt: '2026-08-13T00:00:00.000Z', // expires in <7 days
};

export const MOCK_CONNECTION_NEAR_EXPIRY: JiraHealthConnectionInfo = {
  ...MOCK_CONNECTION_ACTIVE,
  tokenExpiresAt: new Date(Date.now() + 4 * 24 * 3600_000).toISOString(), // 4 days
};

// ---------------------------------------------------------------------------
// Health fixture — healthy
// ---------------------------------------------------------------------------

export const MOCK_HEALTH_HEALTHY: JiraHealthResponse = {
  connections: [MOCK_CONNECTION_ACTIVE],
  sync: {
    lagP95Ms: 1200,
    events24h: { processed: 142, skipped: 3, failed: 0 },
    dlqDepth: 0,
    rateBudgetRemaining: 87,
  },
  webhook: {
    lastReceivedAt: new Date(Date.now() - 30_000).toISOString(),
    signatureFailures24h: 0,
    receiverHealthy: true,
  },
  cachedAt: new Date().toISOString(),
};

/** Health with stale:true (503 scenario — last-known payload). */
export const MOCK_HEALTH_STALE: JiraHealthResponse = {
  ...MOCK_HEALTH_HEALTHY,
  cachedAt: new Date(Date.now() - 120_000).toISOString(), // 2 minutes old
  stale: true,
};

/** Health with DLQ issues. */
export const MOCK_HEALTH_DLQ_CRITICAL: JiraHealthResponse = {
  ...MOCK_HEALTH_HEALTHY,
  sync: {
    ...MOCK_HEALTH_HEALTHY.sync,
    dlqDepth: 15,
    events24h: { processed: 80, skipped: 1, failed: 15 },
  },
  cachedAt: new Date().toISOString(),
};

/** Health with high lag (warning). */
export const MOCK_HEALTH_LAG_WARNING: JiraHealthResponse = {
  ...MOCK_HEALTH_HEALTHY,
  sync: {
    ...MOCK_HEALTH_HEALTHY.sync,
    lagP95Ms: 12_000,
    rateBudgetRemaining: 12,
  },
  cachedAt: new Date().toISOString(),
};

/** Health with no connections configured (first-run). */
export const MOCK_HEALTH_EMPTY: JiraHealthResponse = {
  connections: [],
  sync: { lagP95Ms: null, events24h: { processed: 0, skipped: 0, failed: 0 }, dlqDepth: 0, rateBudgetRemaining: null },
  webhook: { lastReceivedAt: null, signatureFailures24h: 0, receiverHealthy: false },
  cachedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Projects fixture
// ---------------------------------------------------------------------------

export const MOCK_PROJECTS_RESPONSE: JiraProjectsResponse = {
  data: [
    {
      id: '10000',
      key: 'PLAT',
      name: 'Platform Engineering',
      avatarUrl: null,
      issueTypes: [
        { id: '10001', name: 'Bug', iconUrl: null, subtask: false },
        { id: '10002', name: 'Task', iconUrl: null, subtask: false },
        { id: '10003', name: 'Story', iconUrl: null, subtask: false },
      ],
    },
    {
      id: '10001',
      key: 'OPS',
      name: 'Operations',
      avatarUrl: null,
      issueTypes: [
        { id: '10004', name: 'IT Help', iconUrl: null, subtask: false },
        { id: '10005', name: 'Incident', iconUrl: null, subtask: false },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Fields fixture
// ---------------------------------------------------------------------------

export const MOCK_FIELDS_RESPONSE: JiraFieldsResponse = {
  data: [
    { id: 'summary', name: 'Summary', required: true, schema: { type: 'string' }, allowedValues: null },
    { id: 'description', name: 'Description', required: false, schema: { type: 'string' }, allowedValues: null },
    {
      id: 'priority',
      name: 'Priority',
      required: true,
      schema: { type: 'priority' },
      allowedValues: [
        { id: '1', name: 'Highest' },
        { id: '2', name: 'High' },
        { id: '3', name: 'Medium' },
        { id: '4', name: 'Low' },
      ],
    },
    { id: 'assignee', name: 'Assignee', required: false, schema: { type: 'user' }, allowedValues: null },
  ],
};

// ---------------------------------------------------------------------------
// Mappings fixture
// ---------------------------------------------------------------------------

export const MOCK_MAPPINGS_RESPONSE: PaginatedMappingsResponse = {
  data: [
    {
      id: FIXTURE_MAPPING_ID,
      connectionId: FIXTURE_CONNECTION_ID,
      projectKey: 'PLAT',
      projectId: '10000',
      defaultIssueTypeId: '10001',
      fieldMap: [
        {
          source: { type: 'ticket_field', fieldKey: 'subject' },
          target: { fieldId: 'summary', fieldName: 'Summary' },
        },
      ],
      statusMap: [
        { opsninjaStatus: 'open', jiraStatusId: '10000', jiraStatusName: 'To Do' },
        { opsninjaStatus: 'resolved', jiraStatusId: '10002', jiraStatusName: 'Done' },
      ],
      syncRules: { syncComments: true, syncStatusChanges: true, commentVisibility: 'public' },
      isDefault: true,
      enabled: true,
      createdBy: 'admin@acme.com',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-10T15:00:00.000Z',
      version: '2026-08-10T15:00:00.000Z',
    },
  ],
  nextCursor: null,
};

/** Mapping with validation errors (missing required field 'priority'). */
export const MOCK_MAPPING_VALIDATION_ERROR_RESPONSE = {
  error: {
    code: 'JIRA_REQUIRED_FIELD_UNMAPPED',
    message: 'One or more required Jira fields are not mapped.',
    details: [
      { path: 'fieldMap.priority', message: 'Required Jira field "Priority" is not mapped' },
    ],
    traceId: 'trace-jira-validation-001',
  },
};

// ---------------------------------------------------------------------------
// DLQ fixtures
// ---------------------------------------------------------------------------

export const MOCK_DLQ_ITEM_1 = {
  id: FIXTURE_DLQ_EVENT_1,
  tenantId: 'f0580000-0000-0000-0000-000000000001',
  jiraEventId: 'jira-evt-001-abc123def',
  eventType: 'jira:issue_updated',
  jiraIssueKey: 'PLAT-42',
  attempts: 3,
  lastError: 'Connection timeout after 30s',
  receivedAt: new Date(Date.now() - 3600_000).toISOString(),
  processingState: 'failed',
};

export const MOCK_DLQ_ITEM_2 = {
  id: FIXTURE_DLQ_EVENT_2,
  tenantId: 'f0580000-0000-0000-0000-000000000001',
  jiraEventId: 'jira-evt-002-def456ghi',
  eventType: 'jira:comment_created',
  jiraIssueKey: 'OPS-7',
  attempts: 1,
  lastError: 'Ticket not found in OpsNinja',
  receivedAt: new Date(Date.now() - 7200_000).toISOString(),
  processingState: 'failed',
};

export const MOCK_DLQ_PAGE_1: DlqPageResponse = {
  data: [MOCK_DLQ_ITEM_1, MOCK_DLQ_ITEM_2],
  nextCursor: null,
  total: 2,
};

export const MOCK_DLQ_EMPTY: DlqPageResponse = {
  data: [],
  nextCursor: null,
  total: 0,
};

// ---------------------------------------------------------------------------
// Reconciliation fixtures
// ---------------------------------------------------------------------------

export const MOCK_RECON_RUN_COMPLETED = {
  id: FIXTURE_RECON_RUN_1,
  tenantId: 'f0580000-0000-0000-0000-000000000001',
  connectionId: FIXTURE_CONNECTION_ID,
  lookbackHours: 24,
  startedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  completedAt: new Date(Date.now() - 2.5 * 3600_000).toISOString(),
  outcome: 'completed' as const,
  ticketsChecked: 52,
  ticketsResynced: 3,
  errorsCount: 0,
  triggeredBy: 'admin@acme.com',
};

export const MOCK_RECON_RUN_RUNNING = {
  ...MOCK_RECON_RUN_COMPLETED,
  id: 'f0580004-0000-0000-0000-000000000002',
  startedAt: new Date(Date.now() - 600_000).toISOString(),
  completedAt: null,
  outcome: 'running' as const,
  ticketsChecked: 12,
  ticketsResynced: 1,
};

export const MOCK_RECON_RUNS: ReconciliationRunsResponse = {
  data: [MOCK_RECON_RUN_RUNNING, MOCK_RECON_RUN_COMPLETED],
  nextCursor: null,
};

// ---------------------------------------------------------------------------
// Mutable state (allows per-test overrides)
// ---------------------------------------------------------------------------

let currentHealthResponse: JiraHealthResponse = MOCK_HEALTH_HEALTHY;
let currentDlqResponse: DlqPageResponse = MOCK_DLQ_EMPTY;
let currentReconResponse: ReconciliationRunsResponse = { data: [MOCK_RECON_RUN_COMPLETED], nextCursor: null };
let return503 = false;

export function setJiraHealthResponse(r: JiraHealthResponse) { currentHealthResponse = r; }
export function setJiraDlqResponse(r: DlqPageResponse) { currentDlqResponse = r; }
export function setJiraReconResponse(r: ReconciliationRunsResponse) { currentReconResponse = r; }
export function setJira503(v: boolean) { return503 = v; }

export function resetJiraHandlers() {
  currentHealthResponse = MOCK_HEALTH_HEALTHY;
  currentDlqResponse = MOCK_DLQ_EMPTY;
  currentReconResponse = { data: [MOCK_RECON_RUN_COMPLETED], nextCursor: null };
  return503 = false;
}

// ---------------------------------------------------------------------------
// MSW handlers
// ---------------------------------------------------------------------------

export const jiraHandlers = [
  // GET /api/v1/integrations/jira/health
  http.get('/api/v1/integrations/jira/health', () => {
    if (return503) {
      return HttpResponse.json(
        { ...currentHealthResponse, stale: true },
        { status: 503 },
      );
    }
    return HttpResponse.json(currentHealthResponse);
  }),

  // POST /api/v1/integrations/jira/connections/:id/test
  http.post('/api/v1/integrations/jira/connections/:id/test', () => {
    const res: TestConnectionResponse = {
      data: {
        reachable: true,
        latencyMs: 143,
        serverInfo: {
          serverTitle: 'Acme JIRA',
          version: '9.12.0',
          deploymentType: 'Cloud',
        },
        error: null,
      },
    };
    return HttpResponse.json(res);
  }),

  // POST /api/v1/integrations/jira/connections/:id/webhook-secret/rotate
  http.post(
    '/api/v1/integrations/jira/connections/:id/webhook-secret/rotate',
    ({ params }) => {
      const res: RotateWebhookSecretResponse = {
        webhookUrl: `https://app.opsninja.io/api/v1/jira/webhooks/tenant/conn/${params.id as string}`,
        secretOnce: 'abc123' + Math.random().toString(16).slice(2),
        previousValidUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
      return HttpResponse.json(res);
    },
  ),

  // GET /api/v1/integrations/jira/connections/:id/projects
  http.get('/api/v1/integrations/jira/connections/:id/projects', () =>
    HttpResponse.json(MOCK_PROJECTS_RESPONSE),
  ),

  // GET .../projects/:key/issue-types/:typeId/fields
  http.get(
    '/api/v1/integrations/jira/connections/:id/projects/:key/issue-types/:typeId/fields',
    () => HttpResponse.json(MOCK_FIELDS_RESPONSE),
  ),

  // GET /api/v1/integrations/jira/mappings
  http.get('/api/v1/integrations/jira/mappings', () =>
    HttpResponse.json(MOCK_MAPPINGS_RESPONSE),
  ),

  // POST /api/v1/integrations/jira/mappings
  http.post('/api/v1/integrations/jira/mappings', () =>
    HttpResponse.json({ data: MOCK_MAPPINGS_RESPONSE.data[0] }, { status: 201 }),
  ),

  // PUT /api/v1/integrations/jira/mappings/:id
  http.put('/api/v1/integrations/jira/mappings/:id', () =>
    HttpResponse.json({ data: MOCK_MAPPINGS_RESPONSE.data[0] }),
  ),

  // GET /api/v1/integrations/jira/dlq
  http.get('/api/v1/integrations/jira/dlq', () =>
    HttpResponse.json(currentDlqResponse),
  ),

  // POST /api/v1/integrations/jira/dlq/:id/replay
  http.post('/api/v1/integrations/jira/dlq/:id/replay', ({ params }) => {
    const res: ReplayResult = { id: params.id as string, success: true, error: null };
    return HttpResponse.json(res);
  }),

  // POST /api/v1/integrations/jira/dlq/batch-replay
  http.post('/api/v1/integrations/jira/dlq/batch-replay', async ({ request }) => {
    const body = await request.json() as { ids: string[] };
    const res: BatchReplayResponse = {
      results: (body.ids ?? []).map((id) => ({ id, success: true, error: null })),
    };
    return HttpResponse.json(res);
  }),

  // GET /api/v1/integrations/jira/reconciliation/runs
  http.get('/api/v1/integrations/jira/reconciliation/runs', () =>
    HttpResponse.json(currentReconResponse),
  ),

  // POST /api/v1/integrations/jira/reconciliation/runs
  http.post('/api/v1/integrations/jira/reconciliation/runs', async ({ request }) => {
    const body = await request.json() as { connectionId: string; lookbackHours: number };
    const res: TriggerReconciliationResponse = {
      data: {
        id: 'f0580004-0000-0000-0000-' + Date.now().toString().slice(-12).padStart(12, '0'),
        tenantId: 'f0580000-0000-0000-0000-000000000001',
        connectionId: body.connectionId,
        lookbackHours: body.lookbackHours,
        startedAt: new Date().toISOString(),
        completedAt: null,
        outcome: 'running',
        ticketsChecked: 0,
        ticketsResynced: 0,
        errorsCount: 0,
        triggeredBy: 'admin@acme.com',
      },
      auditId: 'audit-recon-trigger-' + Date.now(),
    };
    return HttpResponse.json(res, { status: 201 });
  }),
];
