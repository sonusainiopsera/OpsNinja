/**
 * Portal-safe export surface for @opsninja/ui-kit.
 *
 * IMPORTANT: SlaCountdown and SlaClockProvider are intentionally NOT exported
 * from this file. The customer portal bundle must not include the shared timer
 * or live-countdown logic. Use SlaHint instead.
 *
 * The dependency-graph test (test/portal-dependency-graph.test.ts) asserts that
 * neither SlaCountdown nor SlaClockProvider is transitively reachable from this file.
 */

export { SlaHint } from './domain/SlaHint/SlaHint';
export type { SlaHintProps } from './domain/SlaHint/SlaHint';

export { PriorityBadge, PRIORITY_CSS_VARS } from './domain/PriorityBadge/PriorityBadge';
export type { Priority, PriorityBadgeProps } from './domain/PriorityBadge/PriorityBadge';

export { StatusBadge, STATUS_CSS_VARS } from './domain/StatusBadge/StatusBadge';
export type { TicketStatus, StatusBadgeProps } from './domain/StatusBadge/StatusBadge';

export { OrgChip } from './domain/OrgChip/OrgChip';
export type { OrgChipProps } from './domain/OrgChip/OrgChip';

export { JiraLinkChip, JIRA_CSS_VARS } from './domain/JiraLinkChip/JiraLinkChip';
export type { JiraSyncState, JiraLinkChipProps } from './domain/JiraLinkChip/JiraLinkChip';

export { DataTable } from './domain/DataTable/DataTable';
export type {
  ColumnDef,
  DataTableProps,
  SortState,
  SortDirection,
  Density,
} from './domain/DataTable/DataTable';

export { Icon } from './Icon';
export { slaStateMeta, SLA_CSS_VARS } from './slaStateMeta';
export type { SlaState, SlaStateMeta } from './slaStateMeta';
