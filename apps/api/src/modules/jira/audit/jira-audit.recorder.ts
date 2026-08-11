/**
 * JiraAuditRecorder — WO-059.
 *
 * Wraps the platform AuditWriter with Jira-specific resource/action enums and
 * an explicit field allow-list serialiser per resource type.
 *
 * Design rules:
 *   - All Jira mutations call record() inside the same transaction as the
 *     mutation so audit failure rolls back the data change (fail-closed).
 *   - The allow-list serialiser excludes every field unless explicitly declared,
 *     so newly added columns are excluded by default rather than accidentally
 *     exposed (e.g. OAuth tokens, webhook secrets, raw API keys never appear).
 *   - correlationId flows from the escalate boundary through the outbound Jira
 *     call and back through the inbound webhook apply; it is stored in
 *     metadata so the Jira audit query endpoint can surface it without a new
 *     audit_logs column migration.
 *   - actor_type='integration' is emitted for inbound-applied ticket changes
 *     so engineering-driven resolutions are distinguishable from agent actions.
 */

import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../../audit/audit-writer';

// ---------------------------------------------------------------------------
// Resource taxonomy
// ---------------------------------------------------------------------------

export const JiraResourceType = {
  CONNECTION:          'jira_connection',
  PROJECT_MAPPING:     'jira_project_mapping',
  TICKET_LINK:         'ticket_jira_link',
  DLQ_ITEM:            'jira_dlq_item',
  RECONCILIATION_RUN:  'jira_reconciliation_run',
} as const;

export type JiraResourceType = typeof JiraResourceType[keyof typeof JiraResourceType];

// ---------------------------------------------------------------------------
// Action enums per resource
// ---------------------------------------------------------------------------

export const JiraConnectionAction = {
  CONNECT:   'connect',
  TEST:      'test',
  ROTATE:    'rotate',
  REVOKE:    'revoke',
} as const;
export type JiraConnectionAction = typeof JiraConnectionAction[keyof typeof JiraConnectionAction];

export const JiraMappingAction = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;
export type JiraMappingAction = typeof JiraMappingAction[keyof typeof JiraMappingAction];

export const JiraLinkAction = {
  ESCALATE:    'escalate',
  LINKED:      'linked',
  RETRY:       'retry',
  UNLINK:      'unlink',
  INBOUND_APPLY: 'inbound_apply',
  FAILED:      'failed',
} as const;
export type JiraLinkAction = typeof JiraLinkAction[keyof typeof JiraLinkAction];

export const JiraDlqAction = {
  ENQUEUE:  'enqueue',
  REPLAY:   'replay',
  DISCARD:  'discard',
} as const;
export type JiraDlqAction = typeof JiraDlqAction[keyof typeof JiraDlqAction];

export const JiraReconAction = {
  START:     'start',
  COMPLETE:  'complete',
  FAILED:    'failed',
  SKIPPED:   'skipped',
} as const;
export type JiraReconAction = typeof JiraReconAction[keyof typeof JiraReconAction];

// ---------------------------------------------------------------------------
// Allow-list field sets per resource
// Safe = non-sensitive; secrets, tokens, raw bodies always excluded.
// ---------------------------------------------------------------------------

const CONNECTION_SAFE_FIELDS = new Set([
  'id', 'tenantId', 'name', 'cloudId', 'jiraBaseUrl', 'status',
  'projectCount', 'connectionMode', 'createdAt', 'updatedAt',
  'lastTestedAt', 'lastSyncedAt',
]);

const MAPPING_SAFE_FIELDS = new Set([
  'id', 'tenantId', 'connectionId', 'projectKey', 'projectName',
  'issueTypeId', 'issueTypeName', 'priorityMapping', 'statusMapping',
  'enabled', 'createdAt', 'updatedAt',
]);

const LINK_SAFE_FIELDS = new Set([
  'id', 'tenantId', 'ticketId', 'connectionId', 'mappingId',
  'projectKey', 'jiraIssueId', 'jiraIssueKey', 'jiraIssueUrl',
  'jiraStatus', 'jiraAssignee', 'linkState', 'mode',
  'lastSyncedAt', 'errorCode', 'createdAt', 'updatedAt',
  'reemitCount', 'correlationId',
]);

const DLQ_SAFE_FIELDS = new Set([
  'id', 'tenantId', 'linkId', 'connectionId', 'failureReason',
  'errorCode', 'attempt', 'state', 'createdAt', 'resolvedAt',
]);

const RECON_SAFE_FIELDS = new Set([
  'id', 'tenantId', 'connectionId', 'windowStart', 'windowEnd',
  'issuesScanned', 'driftDetected', 'eventsSynthesised', 'pendingRepaired',
  'orphansFound', 'durationMs', 'outcome', 'watermark', 'createdAt',
]);

const ALLOW_LISTS: Record<JiraResourceType, Set<string>> = {
  [JiraResourceType.CONNECTION]:         CONNECTION_SAFE_FIELDS,
  [JiraResourceType.PROJECT_MAPPING]:    MAPPING_SAFE_FIELDS,
  [JiraResourceType.TICKET_LINK]:        LINK_SAFE_FIELDS,
  [JiraResourceType.DLQ_ITEM]:           DLQ_SAFE_FIELDS,
  [JiraResourceType.RECONCILIATION_RUN]: RECON_SAFE_FIELDS,
};

// ---------------------------------------------------------------------------
// Record input type
// ---------------------------------------------------------------------------

export interface JiraAuditInput {
  resourceType:  JiraResourceType;
  resourceId?:   string | null;
  action:        string;
  /** Actor type — 'staff' | 'machine' | 'integration'. */
  actorType?:    string;
  /** Actor identifier (user id, connection id, etc.). */
  actorId?:      string;
  /** Human-readable display label for the actor (e.g. Jira author name). */
  actorLabel?:   string;
  /** State snapshot before the mutation (will be allow-list filtered). */
  beforeState?:  Record<string, unknown> | null;
  /** State snapshot after the mutation (will be allow-list filtered). */
  afterState?:   Record<string, unknown> | null;
  /** Correlation id threaded from the escalate boundary. */
  correlationId?: string | null;
  /** OpenTelemetry trace id for this request. */
  traceId?:      string | null;
  /** Idempotency key for worker dedup. */
  idempotencyKey?: string | null;
}

// ---------------------------------------------------------------------------
// Serialiser
// ---------------------------------------------------------------------------

/**
 * Produce an allow-listed snapshot of a resource state object.
 * Keys not in the allow-list are silently dropped.
 * Secret fields (token, secret, key, password, credential, authorization,
 * webhook_secret, client_secret, refresh_token, access_token) are always
 * stripped even if they appear in the allow-list.
 */
export function serializeForAudit(
  data: Record<string, unknown>,
  resourceType: JiraResourceType,
): Record<string, unknown> {
  const allowList = ALLOW_LISTS[resourceType];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!allowList.has(key)) continue;
    if (GLOBAL_SENSITIVE_RE.test(key)) continue;
    result[key] = value;
  }
  return result;
}

/** Sensitive key pattern — these are never included regardless of allow-list. */
const GLOBAL_SENSITIVE_RE =
  /token|secret|password|credential|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|webhook[_-]?secret/i;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class JiraAuditRecorder {
  constructor(private readonly auditWriter: AuditWriter) {}

  /**
   * Append a Jira mutation audit record inside the current tenant transaction.
   * Fail-closed: throws on write failure — the enclosing transaction rolls back.
   */
  async record(input: JiraAuditInput): Promise<void> {
    const before = input.beforeState
      ? serializeForAudit(input.beforeState, input.resourceType)
      : null;
    const after = input.afterState
      ? serializeForAudit(input.afterState, input.resourceType)
      : null;

    await this.auditWriter.append({
      resourceType:   input.resourceType,
      resourceId:     input.resourceId ?? null,
      action:         input.action,
      beforeState:    before,
      afterState:     after,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: {
        ...(input.correlationId  ? { correlationId:  input.correlationId  } : {}),
        ...(input.traceId        ? { traceId:        input.traceId        } : {}),
        ...(input.actorType      ? { jiraActorType:  input.actorType      } : {}),
        ...(input.actorId        ? { jiraActorId:    input.actorId        } : {}),
        ...(input.actorLabel     ? { jiraActorLabel: input.actorLabel     } : {}),
      },
    });
  }

  /**
   * Convenience wrapper for inbound-applied ticket changes.
   * Sets actor_type='integration' with the connectionId as the actor identifier
   * and the Jira author display name as the actor label.
   */
  async recordInboundApply(opts: {
    linkId:         string;
    connectionId:   string;
    jiraAuthorName?: string;
    beforeState?:   Record<string, unknown> | null;
    afterState?:    Record<string, unknown> | null;
    correlationId?: string | null;
    idempotencyKey?: string | null;
  }): Promise<void> {
    return this.record({
      resourceType:   JiraResourceType.TICKET_LINK,
      resourceId:     opts.linkId,
      action:         JiraLinkAction.INBOUND_APPLY,
      actorType:      'integration',
      actorId:        opts.connectionId,
      actorLabel:     opts.jiraAuthorName,
      beforeState:    opts.beforeState ?? null,
      afterState:     opts.afterState ?? null,
      correlationId:  opts.correlationId ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
    });
  }

  /**
   * Derive a canonical idempotency key for a worker event.
   * Delegates to AuditWriter's static method.
   */
  static deriveIdempotencyKey(tenantId: string, eventId: string, action: string): string {
    return AuditWriter.deriveIdempotencyKey(tenantId, eventId, action);
  }
}
