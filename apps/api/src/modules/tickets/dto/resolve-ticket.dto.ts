/**
 * ResolveTicketDto — strict Zod schema for POST /api/v1/tickets/{id}/resolve.
 *
 * Security invariants:
 *   - .strict() rejects any unknown property with 400 VALIDATION_ERROR.
 *   - `version` is REQUIRED for optimistic concurrency.
 *   - `resolution_note` is REQUIRED — a ticket cannot be resolved without a note.
 *   - Already-resolved tickets are handled idempotently — repeat calls return
 *     200 with the existing state and emit no duplicate events.
 */

import { z } from 'zod';

export const ResolveTicketSchema = z
  .object({
    /**
     * Current version of the ticket for optimistic concurrency.
     * Required. Must match the version stored in the DB.
     */
    version: z.number().int().positive(),

    /**
     * Required resolution summary.
     * Stored in ticket_status_history.reason for the resolved transition.
     * Also stored in the ticket row itself (mapped to description supplement).
     * 1–10_000 characters.
     */
    resolution_note: z.string().trim().min(1, 'resolution_note is required').max(10_000),

    /**
     * Optional final categorisation at resolution time.
     * Overrides the ticket's existing category_id.
     */
    category_id: z.string().uuid('category_id must be a UUID').optional(),
  })
  .strict();

export type ResolveTicketDto = z.infer<typeof ResolveTicketSchema>;
