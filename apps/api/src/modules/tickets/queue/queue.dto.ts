/**
 * Queue list request DTOs — WO-040.
 *
 * GET /api/v1/tickets query parameter schema.
 *
 * Either view_id OR filter (inline AST) may be supplied; both may be omitted
 * to list all tickets in scope with no filter. They may not both be supplied.
 *
 * Limit is hard-capped at 100 regardless of client input.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sort spec (mirrors views dto; duplicated here so the queue dto is standalone)
// ---------------------------------------------------------------------------

export const QUEUE_SORTABLE_FIELDS = [
  'created_at',
  'updated_at',
  'resolved_at',
  'priority',
  'status',
  'sla_state',
] as const;

export type QueueSortField = (typeof QUEUE_SORTABLE_FIELDS)[number];

export const queueSortItemSchema = z.object({
  field: z.enum(QUEUE_SORTABLE_FIELDS),
  direction: z.enum(['asc', 'desc']),
});

export type QueueSortItem = z.infer<typeof queueSortItemSchema>;

// ---------------------------------------------------------------------------
// Main query schema
// ---------------------------------------------------------------------------

export const QueueQuerySchema = z.object({
  /** Saved view id — mutually exclusive with filter. */
  view_id: z.string().uuid().optional(),

  /**
   * Inline filter AST (JSON-encoded string).
   * Mutually exclusive with view_id.
   */
  filter: z.string().optional(),

  /**
   * Sort specification (JSON-encoded array of { field, direction }).
   * Defaults to [{ field: 'updated_at', direction: 'desc' }].
   */
  sort: z.string().optional(),

  /**
   * Keyset pagination cursor (opaque base64url string).
   * Omit for first page.
   */
  cursor: z.string().optional(),

  /**
   * Number of rows per page. Default 25, hard cap 100.
   */
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v ?? '25', 10);
      return Math.min(Math.max(isNaN(n) ? 25 : n, 1), 100);
    }),
}).refine(
  (d) => !(d.view_id && d.filter),
  { message: 'view_id and filter are mutually exclusive.' },
);

export type QueueQueryDto = z.infer<typeof QueueQuerySchema>;

// ---------------------------------------------------------------------------
// Parsed sort spec (after JSON.parse of the sort query param)
// ---------------------------------------------------------------------------

export const ParsedSortSchema = z
  .array(queueSortItemSchema)
  .min(1)
  .max(3);

/** Default sort when none supplied: newest updated first. */
export const DEFAULT_SORT: QueueSortItem[] = [
  { field: 'updated_at', direction: 'desc' },
];
