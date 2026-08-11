/**
 * Portal-safe entry point for @opsninja/ui-kit.
 *
 * Consumers importing from "@opsninja/ui-kit/portal" are guaranteed that
 * SlaCountdown and SlaClockProvider are NOT reachable transitively from
 * this file.  The customer portal must not depend on the agent SLA clock.
 *
 * The portal may only use SlaHint for static SLA state display.
 */

// Tokens
export * from './tokens/sla-state-meta';
export * from './tokens/priority-meta';
export * from './tokens/status-meta';

// Portal-safe SLA affordance (no countdown, no clock provider)
export { SlaHint } from './domain/SlaHint/SlaHint';
export type { SlaHintProps } from './domain/SlaHint/SlaHint';

// Shared domain components
export { PriorityBadge } from './domain/PriorityBadge/PriorityBadge';
export type { PriorityBadgeProps } from './domain/PriorityBadge/PriorityBadge';

export { StatusBadge } from './domain/StatusBadge/StatusBadge';
export type { StatusBadgeProps } from './domain/StatusBadge/StatusBadge';

export { OrgChip } from './domain/OrgChip/OrgChip';
export type { OrgChipProps } from './domain/OrgChip/OrgChip';

export { JiraLinkChip } from './domain/JiraLinkChip/JiraLinkChip';
export type { JiraLinkChipProps, JiraSyncState } from './domain/JiraLinkChip/JiraLinkChip';

export { DataTable } from './domain/DataTable/DataTable';
export type { DataTableProps, ColumnDef, SortDirection, TableDensity } from './domain/DataTable/DataTable';

export { useGridKeyboardNavigation } from './domain/DataTable/useGridKeyboardNavigation';
export type {
  GridCell,
  UseGridKeyboardNavigationOptions,
  UseGridKeyboardNavigationResult,
} from './domain/DataTable/useGridKeyboardNavigation';
