/**
 * DTOs for the saved-views endpoints.
 *
 * Validation is intentionally shallow here: filter_ast and sort_spec are
 * validated deeply inside ViewsService which delegates to the filter-compiler
 * and the sort-spec allow-list respectively. Zod only validates the outer
 * envelope shape and string/array types.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Allow-listed display columns
// ---------------------------------------------------------------------------

export const ALLOWED_COLUMNS = [
  'id', 'subject', 'status', 'priority', 'organization',
  'assignee', 'category', 'sla_state', 'created_at', 'updated_at',
  'resolved_at', 'has_jira_link', 'tag',
] as const;

export type ColumnKey = typeof ALLOWED_COLUMNS[number];

const columnKeySchema = z.enum(ALLOWED_COLUMNS);

// ---------------------------------------------------------------------------
// Allow-listed sort fields and directions
// ---------------------------------------------------------------------------

const SORTABLE_FIELDS = [
  'created_at', 'updated_at', 'resolved_at', 'priority', 'status',
  'sla_state',
] as const;

const sortSpecItemSchema = z.object({
  field: z.enum(SORTABLE_FIELDS),
  direction: z.enum(['asc', 'desc']),
});

export type SortSpecItem = z.infer<typeof sortSpecItemSchema>;

export const sortSpecSchema = z
  .array(sortSpecItemSchema)
  .max(3, { message: 'At most 3 sort fields are allowed' })
  .default([]);

// ---------------------------------------------------------------------------
// Scope enum
// ---------------------------------------------------------------------------

const viewScopeSchema = z.enum(['private', 'shared']);

// ---------------------------------------------------------------------------
// POST /api/v1/views — create a new custom view
// ---------------------------------------------------------------------------

export const CreateViewSchema = z.object({
  name: z.string().min(1).max(200),
  filter_ast: z.unknown().default({}),
  sort_spec: sortSpecSchema,
  columns: z.array(columnKeySchema).default([]),
  scope: viewScopeSchema.default('private'),
});

export type CreateViewDto = z.infer<typeof CreateViewSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/v1/views/:id — update a custom view
// ---------------------------------------------------------------------------

export const UpdateViewSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  filter_ast: z.unknown().optional(),
  sort_spec: sortSpecSchema.optional(),
  columns: z.array(columnKeySchema).optional(),
  scope: viewScopeSchema.optional(),
});

export type UpdateViewDto = z.infer<typeof UpdateViewSchema>;

// ---------------------------------------------------------------------------
// PUT /api/v1/views/pins/order — batch reorder pinned views
// ---------------------------------------------------------------------------

export const ReorderPinsSchema = z.object({
  view_ids: z.array(z.string().uuid()).min(1).max(100),
});

export type ReorderPinsDto = z.infer<typeof ReorderPinsSchema>;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface ViewPinState {
  is_pinned: boolean;
  pin_order: number | null;
}

export interface ViewOwner {
  id: string;
}

export interface SavedViewResponse {
  id: string;
  name: string;
  scope: 'system' | 'private' | 'shared';
  is_pinned: boolean;
  pin_order: number | null;
  filter_ast: unknown;
  sort_spec: SortSpecItem[];
  columns: string[];
  owner: ViewOwner | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}
