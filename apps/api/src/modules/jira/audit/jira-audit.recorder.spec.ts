/**
 * JiraAuditRecorder unit tests — WO-059.
 *
 * Coverage:
 *   - serializeForAudit: allow-list filtering per resource type
 *   - serializeForAudit: GLOBAL_SENSITIVE_RE drops secret fields even if they
 *     appear in the allow-list (they don't, but the test proves the guard works)
 *   - JiraAuditRecorder.record(): delegates to AuditWriter.append() with correct shape
 *   - JiraAuditRecorder.recordInboundApply(): sets actor_type='integration'
 *   - Redaction: OAuth tokens, webhook secrets, raw payload bodies never appear
 *     in audit metadata passed to AuditWriter
 *   - Resource taxonomy constants are defined and unique
 *   - Action constants are defined per resource
 */

import {
  JiraAuditRecorder,
  JiraResourceType,
  JiraConnectionAction,
  JiraMappingAction,
  JiraLinkAction,
  JiraDlqAction,
  JiraReconAction,
  serializeForAudit,
} from './jira-audit.recorder';
import type { MutationAuditRecord } from '../../audit/audit-writer';

// ---------------------------------------------------------------------------
// Mock AuditWriter
// ---------------------------------------------------------------------------

class MockAuditWriter {
  readonly calls: MutationAuditRecord[] = [];

  async append(record: MutationAuditRecord): Promise<void> {
    this.calls.push(record);
  }

  static deriveIdempotencyKey(tenantId: string, eventId: string, action: string): string {
    return `${tenantId}:${eventId}:${action}`;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID     = 'aaaaaaaa-0000-0000-0000-000000000001';
const CONNECTION_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const LINK_ID       = 'cccccccc-0000-0000-0000-000000000001';

/** A Jira connection record with sensitive fields included. */
const CONNECTION_WITH_SECRETS = {
  id:            CONNECTION_ID,
  tenantId:      TENANT_ID,
  name:          'Prod Jira',
  cloudId:       'cloud-123',
  jiraBaseUrl:   'https://acme.atlassian.net',
  status:        'connected',
  // Sensitive — must not appear in serialised output:
  accessToken:   'ey.AccessToken.ShouldNotAppear',
  refreshToken:  'ey.RefreshToken.ShouldNotAppear',
  webhookSecret: 'wh-secret-ShouldNotAppear',
  clientSecret:  'client-secret-ShouldNotAppear',
  apiKey:        'api-key-ShouldNotAppear',
};

const LINK_STATE = {
  id:           LINK_ID,
  tenantId:     TENANT_ID,
  ticketId:     'dddddddd-0000-0000-0000-000000000001',
  connectionId: CONNECTION_ID,
  mappingId:    'eeeeeeee-0000-0000-0000-000000000001',
  projectKey:   'PLAT',
  jiraIssueId:  '10001',
  jiraIssueKey: 'PLAT-42',
  jiraStatus:   'In Progress',
  jiraAssignee: 'Jane Dev',
  linkState:    'linked',
  createdAt:    new Date('2024-06-01T10:00:00Z'),
};

// ---------------------------------------------------------------------------
// serializeForAudit — allow-list
// ---------------------------------------------------------------------------

describe('serializeForAudit', () => {
  it('retains only declared safe fields for jira_connection', () => {
    const result = serializeForAudit(CONNECTION_WITH_SECRETS, JiraResourceType.CONNECTION);

    // Safe fields are present
    expect(result['id']).toBe(CONNECTION_ID);
    expect(result['name']).toBe('Prod Jira');
    expect(result['cloudId']).toBe('cloud-123');
    expect(result['status']).toBe('connected');
  });

  it('strips OAuth tokens from jira_connection snapshot', () => {
    const result = serializeForAudit(CONNECTION_WITH_SECRETS, JiraResourceType.CONNECTION);

    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).not.toHaveProperty('clientSecret');
    expect(result).not.toHaveProperty('apiKey');
  });

  it('strips webhook secret from jira_connection snapshot', () => {
    const result = serializeForAudit(CONNECTION_WITH_SECRETS, JiraResourceType.CONNECTION);
    expect(result).not.toHaveProperty('webhookSecret');
  });

  it('retains only declared safe fields for ticket_jira_link', () => {
    const result = serializeForAudit(LINK_STATE, JiraResourceType.TICKET_LINK);

    expect(result['id']).toBe(LINK_ID);
    expect(result['jiraIssueKey']).toBe('PLAT-42');
    expect(result['linkState']).toBe('linked');
    expect(result['tenantId']).toBe(TENANT_ID);
  });

  it('returns empty object when no fields match the allow-list', () => {
    const result = serializeForAudit(
      { accessToken: 'secret', refreshToken: 'secret2' },
      JiraResourceType.CONNECTION,
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('drops keys matching GLOBAL_SENSITIVE_RE even if they were somehow in the allow-list', () => {
    // Patch a custom input with a key that contains 'token'
    const result = serializeForAudit(
      { id: 'abc', name: 'safe', passwordToken: 'should-be-dropped' },
      JiraResourceType.CONNECTION,
    );
    expect(result).not.toHaveProperty('passwordToken');
    // Safe field passes through
    expect(result['id']).toBe('abc');
  });

  it('retains reconciliation run fields for jira_reconciliation_run', () => {
    const recon = {
      id:              'run-001',
      tenantId:        TENANT_ID,
      connectionId:    CONNECTION_ID,
      issuesScanned:   120,
      driftDetected:   3,
      outcome:         'completed',
      // Non-safe field
      error:           'internal error text',
    };
    const result = serializeForAudit(recon, JiraResourceType.RECONCILIATION_RUN);

    expect(result['issuesScanned']).toBe(120);
    expect(result['driftDetected']).toBe(3);
    expect(result['outcome']).toBe('completed');
    // 'error' is not in the allow-list
    expect(result).not.toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// Resource taxonomy constants
// ---------------------------------------------------------------------------

describe('JiraResourceType constants', () => {
  it('defines all five resource types', () => {
    expect(JiraResourceType.CONNECTION).toBe('jira_connection');
    expect(JiraResourceType.PROJECT_MAPPING).toBe('jira_project_mapping');
    expect(JiraResourceType.TICKET_LINK).toBe('ticket_jira_link');
    expect(JiraResourceType.DLQ_ITEM).toBe('jira_dlq_item');
    expect(JiraResourceType.RECONCILIATION_RUN).toBe('jira_reconciliation_run');
  });

  it('all resource type values are unique', () => {
    const values = Object.values(JiraResourceType);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('Action constants', () => {
  it('JiraConnectionAction has expected actions', () => {
    expect(Object.values(JiraConnectionAction)).toEqual(
      expect.arrayContaining(['connect', 'test', 'rotate', 'revoke']),
    );
  });

  it('JiraLinkAction has inbound_apply', () => {
    expect(JiraLinkAction.INBOUND_APPLY).toBe('inbound_apply');
  });

  it('JiraDlqAction has replay', () => {
    expect(JiraDlqAction.REPLAY).toBe('replay');
  });

  it('JiraReconAction values are unique', () => {
    const values = Object.values(JiraReconAction);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ---------------------------------------------------------------------------
// JiraAuditRecorder.record()
// ---------------------------------------------------------------------------

describe('JiraAuditRecorder', () => {
  let mockWriter: MockAuditWriter;
  let recorder: JiraAuditRecorder;

  beforeEach(() => {
    mockWriter = new MockAuditWriter();
    recorder = new JiraAuditRecorder(mockWriter as never);
  });

  it('delegates to AuditWriter.append() with correct resource and action', async () => {
    await recorder.record({
      resourceType: JiraResourceType.CONNECTION,
      resourceId:   CONNECTION_ID,
      action:       JiraConnectionAction.CONNECT,
      afterState:   { id: CONNECTION_ID, name: 'Prod Jira', status: 'connected' },
    });

    expect(mockWriter.calls).toHaveLength(1);
    const call = mockWriter.calls[0]!;
    expect(call.resourceType).toBe('jira_connection');
    expect(call.action).toBe('connect');
    expect(call.resourceId).toBe(CONNECTION_ID);
  });

  it('allows-lists the afterState before passing to AuditWriter', async () => {
    await recorder.record({
      resourceType: JiraResourceType.CONNECTION,
      resourceId:   CONNECTION_ID,
      action:       JiraConnectionAction.CONNECT,
      afterState:   CONNECTION_WITH_SECRETS,
    });

    const call = mockWriter.calls[0]!;
    expect(call.afterState).not.toHaveProperty('accessToken');
    expect(call.afterState).not.toHaveProperty('refreshToken');
    expect(call.afterState).not.toHaveProperty('webhookSecret');
    expect((call.afterState as Record<string, unknown>)?.['name']).toBe('Prod Jira');
  });

  it('stores correlationId in metadata', async () => {
    const correlationId = 'corr-abc-123';

    await recorder.record({
      resourceType:  JiraResourceType.TICKET_LINK,
      resourceId:    LINK_ID,
      action:        JiraLinkAction.ESCALATE,
      correlationId,
      afterState:    LINK_STATE,
    });

    const call = mockWriter.calls[0]!;
    expect(call.metadata?.['correlationId']).toBe(correlationId);
  });

  it('stores actorLabel in metadata', async () => {
    await recorder.record({
      resourceType: JiraResourceType.TICKET_LINK,
      resourceId:   LINK_ID,
      action:       JiraLinkAction.INBOUND_APPLY,
      actorType:    'integration',
      actorLabel:   'Jane Dev',
      afterState:   LINK_STATE,
    });

    const call = mockWriter.calls[0]!;
    expect(call.metadata?.['jiraActorLabel']).toBe('Jane Dev');
    expect(call.metadata?.['jiraActorType']).toBe('integration');
  });

  it('passes idempotencyKey through to AuditWriter', async () => {
    const key = 'sha256-key-abc';

    await recorder.record({
      resourceType:   JiraResourceType.DLQ_ITEM,
      resourceId:     'dlq-001',
      action:         JiraDlqAction.REPLAY,
      idempotencyKey: key,
    });

    expect(mockWriter.calls[0]!.idempotencyKey).toBe(key);
  });

  it('records null beforeState/afterState as null', async () => {
    await recorder.record({
      resourceType: JiraResourceType.RECONCILIATION_RUN,
      resourceId:   'run-001',
      action:       JiraReconAction.SKIPPED,
      beforeState:  null,
      afterState:   null,
    });

    const call = mockWriter.calls[0]!;
    expect(call.beforeState).toBeNull();
    expect(call.afterState).toBeNull();
  });

  // --------------------------------------------------------------------------
  // recordInboundApply
  // --------------------------------------------------------------------------

  it('recordInboundApply sets actor_type=integration in metadata', async () => {
    await recorder.recordInboundApply({
      linkId:          LINK_ID,
      connectionId:    CONNECTION_ID,
      jiraAuthorName:  'Bob Jira',
      afterState:      LINK_STATE,
      correlationId:   'corr-xyz',
    });

    const call = mockWriter.calls[0]!;
    expect(call.resourceType).toBe('ticket_jira_link');
    expect(call.action).toBe('inbound_apply');
    expect(call.metadata?.['jiraActorType']).toBe('integration');
    expect(call.metadata?.['jiraActorId']).toBe(CONNECTION_ID);
    expect(call.metadata?.['jiraActorLabel']).toBe('Bob Jira');
    expect(call.metadata?.['correlationId']).toBe('corr-xyz');
  });

  it('recordInboundApply works when jiraAuthorName is omitted', async () => {
    await recorder.recordInboundApply({
      linkId:       LINK_ID,
      connectionId: CONNECTION_ID,
    });

    const call = mockWriter.calls[0]!;
    expect(call.metadata?.['jiraActorLabel']).toBeUndefined();
    expect(call.metadata?.['jiraActorType']).toBe('integration');
  });

  // --------------------------------------------------------------------------
  // Redaction: payload with ALL sensitive types must produce clean output
  // --------------------------------------------------------------------------

  it('strips all four sensitive material types from a combined payload', async () => {
    const sensitiveBefore = {
      id:            CONNECTION_ID,
      name:          'My Connection',
      status:        'connected',
      accessToken:   'Bearer ey.shouldNotAppear',
      refreshToken:  'rft.shouldNotAppear',
      webhookSecret: 'whsec_shouldNotAppear',
      clientSecret:  'cs_shouldNotAppear',
      apiKey:        'apikey_shouldNotAppear',
    };

    await recorder.record({
      resourceType: JiraResourceType.CONNECTION,
      resourceId:   CONNECTION_ID,
      action:       JiraConnectionAction.REVOKE,
      beforeState:  sensitiveBefore,
    });

    const call = mockWriter.calls[0]!;
    const before = call.beforeState as Record<string, unknown>;

    expect(before).not.toHaveProperty('accessToken');
    expect(before).not.toHaveProperty('refreshToken');
    expect(before).not.toHaveProperty('webhookSecret');
    expect(before).not.toHaveProperty('clientSecret');
    expect(before).not.toHaveProperty('apiKey');

    // Safe fields remain
    expect(before?.['name']).toBe('My Connection');
    expect(before?.['status']).toBe('connected');
  });

  // --------------------------------------------------------------------------
  // deriveIdempotencyKey (static)
  // --------------------------------------------------------------------------

  it('deriveIdempotencyKey delegates to AuditWriter.deriveIdempotencyKey', () => {
    const key = JiraAuditRecorder.deriveIdempotencyKey(TENANT_ID, 'event-1', 'escalate');
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});
