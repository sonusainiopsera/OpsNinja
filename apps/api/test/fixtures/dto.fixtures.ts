import { z } from 'zod';

/**
 * Deterministic DTO fixtures for unit and integration tests.
 * All values are static so tests produce reproducible snapshots.
 */

// ─── Stub DTO schema (used by StubController) ──────────────────────────────────

export const StubItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

export type StubItem = z.infer<typeof StubItemSchema>;

export const StubListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export type StubListQuery = z.infer<typeof StubListQuerySchema>;

// ─── Sample valid payloads ─────────────────────────────────────────────────────

export const SAMPLE_STUB_ITEM: StubItem = {
  id: 'item-fixture-001',
  title: 'Sample fixture item',
  priority: 'high',
};

/** An invalid DTO payload that should trigger a 400 VALIDATION_ERROR. */
export const INVALID_STUB_ITEM_PAYLOAD = {
  id: '', // fails min(1)
  title: 123, // wrong type
  priority: 'urgent', // not in enum
};

/** A valid pagination query with a small limit. */
export const SAMPLE_LIST_QUERY: StubListQuery = {
  cursor: undefined,
  limit: 2,
};
