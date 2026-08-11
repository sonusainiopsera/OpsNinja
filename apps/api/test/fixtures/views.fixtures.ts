/**
 * Committed fixture views covering each supported field and operator
 * combination (WO-039 AC-10).
 *
 * Each fixture has a slug for idempotent seeding, a complete filter_ast,
 * sort_spec, and columns array, all of which pass the compiler at write time.
 */

import type { CreateViewDto } from '../../src/modules/views/dto/save-view.dto';

// ---------------------------------------------------------------------------
// Tenant and user UUIDs (deterministic — used across the integration suite)
// ---------------------------------------------------------------------------

export const VIEWS_FIXTURE_TENANT = 'c0000001-0000-0000-0000-000000000001';
export const VIEWS_FIXTURE_AGENT_A = 'c0000002-0000-0000-0000-000000000001';
export const VIEWS_FIXTURE_AGENT_B = 'c0000002-0000-0000-0000-000000000002';
export const VIEWS_FIXTURE_MANAGER = 'c0000002-0000-0000-0000-000000000003';

// ---------------------------------------------------------------------------
// Fixture view definitions — each exercises a distinct field/operator combo
// ---------------------------------------------------------------------------

export const FIXTURE_VIEWS: Array<CreateViewDto & { _slug: string }> = [
  {
    _slug: 'test-status-in',
    name: 'Open and In-Progress (status in)',
    filter_ast: {
      op: 'and',
      conditions: [
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
      ],
    },
    sort_spec: [{ field: 'created_at', direction: 'desc' }],
    columns: ['subject', 'status', 'priority', 'assignee'],
    scope: 'private',
  },
  {
    _slug: 'test-priority-eq',
    name: 'P1 tickets (priority eq)',
    filter_ast: {
      op: 'and',
      conditions: [
        { field: 'priority', operator: 'eq', value: 'P1' },
        { field: 'status', operator: 'neq', value: 'closed' },
      ],
    },
    sort_spec: [{ field: 'created_at', direction: 'asc' }],
    columns: ['subject', 'priority', 'sla_state'],
    scope: 'private',
  },
  {
    _slug: 'test-assignee-null',
    name: 'Unassigned tickets (assignee is_null)',
    filter_ast: {
      op: 'and',
      conditions: [
        { field: 'assignee_user_id', operator: 'is_null', value: null },
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
      ],
    },
    sort_spec: [{ field: 'priority', direction: 'asc' }],
    columns: ['subject', 'priority', 'organization', 'created_at'],
    scope: 'private',
  },
  {
    _slug: 'test-sla-state-warning',
    name: 'SLA warning or breached (sla_state in)',
    filter_ast: {
      op: 'and',
      conditions: [
        { field: 'sla_state', operator: 'in', value: ['warning', 'breached'] },
      ],
    },
    sort_spec: [{ field: 'sla_state', direction: 'asc' }],
    columns: ['subject', 'priority', 'sla_state', 'organization'],
    scope: 'shared',
  },
  {
    _slug: 'test-created-between',
    name: 'Created this week (created_at between)',
    filter_ast: {
      op: 'and',
      conditions: [
        { field: 'created_at', operator: 'between', value: ['LAST_7_DAYS', 'NOW'] },
      ],
    },
    sort_spec: [{ field: 'created_at', direction: 'desc' }],
    columns: ['subject', 'status', 'created_at', 'assignee'],
    scope: 'private',
  },
  {
    _slug: 'test-jira-linked',
    name: 'Jira-linked tickets (has_jira_link eq true)',
    filter_ast: {
      op: 'and',
      conditions: [
        { field: 'has_jira_link', operator: 'eq', value: true },
        { field: 'status', operator: 'not_in', value: ['resolved', 'closed'] },
      ],
    },
    sort_spec: [{ field: 'updated_at', direction: 'desc' }],
    columns: ['subject', 'status', 'organization', 'has_jira_link'],
    scope: 'private',
  },
  {
    _slug: 'test-complex-nested',
    name: 'Complex nested AND/OR filter',
    filter_ast: {
      op: 'and',
      conditions: [
        {
          op: 'or',
          conditions: [
            { field: 'priority', operator: 'eq', value: 'P1' },
            { field: 'priority', operator: 'eq', value: 'P2' },
          ],
        },
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
        { field: 'sla_state', operator: 'neq', value: 'paused' },
      ],
    },
    sort_spec: [{ field: 'priority', direction: 'asc' }, { field: 'created_at', direction: 'desc' }],
    columns: ['subject', 'priority', 'status', 'sla_state', 'organization'],
    scope: 'private',
  },
];

// ---------------------------------------------------------------------------
// Invalid AST fixture (used to test 400 rejection at write time)
// ---------------------------------------------------------------------------

export const INVALID_AST_FIXTURE = {
  op: 'and',
  conditions: [
    { field: 'nonexistent_field', operator: 'eq', value: 'anything' },
  ],
};

export const INVALID_OPERATOR_FIXTURE = {
  op: 'and',
  conditions: [
    { field: 'status', operator: 'contains', value: 'open' }, // 'contains' not allowed for status
  ],
};
