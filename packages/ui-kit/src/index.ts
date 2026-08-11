// Tokens
export * from './tokens/sla-state-meta';
export * from './tokens/priority-meta';
export * from './tokens/status-meta';

// SLA clock and countdown (agent-facing only — not for portal)
export { SlaClockProvider, useSlaClockContext } from './domain/SlaClockProvider';
export type { SlaClockContextValue, SlaClockProviderProps } from './domain/SlaClockProvider';

export { SlaCountdown } from './domain/SlaCountdown/SlaCountdown';
export type { SlaCountdownProps } from './domain/SlaCountdown/SlaCountdown';

export { computeRemaining, formatDuration } from './domain/SlaCountdown/computeRemaining';
export type {
  ComputeRemainingInput,
  ComputeRemainingResult,
  SlaDisplayState,
} from './domain/SlaCountdown/computeRemaining';

// Shared domain components (portal-safe)
export { SlaHint } from './domain/SlaHint/SlaHint';
export type { SlaHintProps } from './domain/SlaHint/SlaHint';

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
