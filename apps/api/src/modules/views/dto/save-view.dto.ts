import { z } from 'zod';

// ── Allowed sort fields ────────────────────────────────────────────────────────

export const ALLOWED_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'status',
  'priority',
  'subject',
  'sla_breach_at',
  'assignee_id',
  'organization_id',
] as const;

export type AllowedSortField = (typeof ALLOWED_SORT_FIELDS)[number];

// ── Allowed display columns ───────────────────────────────────────────────────

export const ALLOWED_COLUMNS = [
  'id',
  'subject',
  'status',
  'priority',
  'assignee',
  'organization',
  'created_at',
  'updated_at',
  'sla_breach_at',
  'sla_state',
  'ticket_number',
  'tags',
] as const;

export type AllowedColumn = (typeof ALLOWED_COLUMNS)[number];

// ── Sort spec schema ──────────────────────────────────────────────────────────

export const SortEntrySchema = z.object({
  field: z.enum(ALLOWED_SORT_FIELDS as [string, ...string[]]),
  direction: z.enum(['asc', 'desc']),
});

export const SortSpecSchema = z
  .array(SortEntrySchema)
  .max(5, 'Cannot specify more than 5 sort fields')
  .default([]);

// ── View scope ────────────────────────────────────────────────────────────────

export const ViewScopeSchema = z.enum(['private', 'shared']);
export type ViewScope = z.infer<typeof ViewScopeSchema>;

// ── Create / PATCH DTOs ───────────────────────────────────────────────────────

export const CreateViewSchema = z.object({
  name: z.string().min(1).max(255),
  filter_ast: z.unknown(),
  sort_spec: SortSpecSchema.optional(),
  columns: z
    .array(z.enum(ALLOWED_COLUMNS as [string, ...string[]]))
    .max(20)
    .optional(),
  scope: ViewScopeSchema.default('private'),
});

export type CreateViewDto = z.infer<typeof CreateViewSchema>;

export const PatchViewSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  filter_ast: z.unknown().optional(),
  sort_spec: SortSpecSchema.optional(),
  columns: z
    .array(z.enum(ALLOWED_COLUMNS as [string, ...string[]]))
    .max(20)
    .optional(),
  scope: ViewScopeSchema.optional(),
});

export type PatchViewDto = z.infer<typeof PatchViewSchema>;

// ── Reorder DTO ───────────────────────────────────────────────────────────────

export const ReorderPinsSchema = z.object({
  view_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(200),
});

export type ReorderPinsDto = z.infer<typeof ReorderPinsSchema>;

// ── Response shape ────────────────────────────────────────────────────────────

export interface SortEntry {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ViewResponse {
  id: string;
  name: string;
  scope: string;
  is_pinned: boolean;
  pin_order: number | null;
  filter_ast: unknown;
  sort_spec: SortEntry[];
  columns: string[];
  owner: { id: string } | null;
  updated_at: string;
}
