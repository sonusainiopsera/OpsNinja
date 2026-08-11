/**
 * Saved view types for the agent workspace — WO-041.
 */

import type { FilterAst } from '@opsninja/filter-compiler';

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type ViewScope = 'private' | 'shared';

export interface SavedView {
  id: string;
  tenantId: string;
  name: string;
  scope: ViewScope;
  pinned: boolean;
  pinnedOrder: number | null;
  isSystem: boolean;
  filter: FilterAst | null;
  columns: string[] | null;
  sort: string | null;
  sortDir: 'asc' | 'desc' | null;
  ticketCount: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ViewListResponse {
  data: SavedView[];
}

export interface ViewResponse {
  data: SavedView;
}

// ---------------------------------------------------------------------------
// Create / update forms
// ---------------------------------------------------------------------------

export interface CreateViewPayload {
  name: string;
  scope: ViewScope;
  filter: FilterAst | null;
  columns?: string[] | null;
  sort?: string | null;
  sortDir?: 'asc' | 'desc' | null;
}

export interface UpdateViewPayload {
  version: number;
  name?: string;
  scope?: ViewScope;
  filter?: FilterAst | null;
  columns?: string[] | null;
  sort?: string | null;
  sortDir?: 'asc' | 'desc' | null;
  pinned?: boolean;
  pinnedOrder?: number | null;
}

// ---------------------------------------------------------------------------
// Well-known system view IDs
// ---------------------------------------------------------------------------

export const SYSTEM_VIEW_IDS = {
  ALL_OPEN: 'system:all-open',
  MY_OPEN: 'system:my-open',
  UNASSIGNED: 'system:unassigned',
  BREACHED_SLA: 'system:breached-sla',
} as const;
