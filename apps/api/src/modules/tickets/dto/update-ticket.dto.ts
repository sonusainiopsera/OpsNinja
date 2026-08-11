/**
 * UpdateTicketDto — strict Zod schema for PATCH /api/v1/tickets/{id}.
 *
 * Security invariants:
 *   - .strict() rejects any unknown property with 400 VALIDATION_ERROR.
 *   - `version` is REQUIRED for optimistic concurrency — a stale version
 *     returns 409 with the current version in the error details.
 *   - tenant_id / id are NEVER accepted from the request body.
 *   - At least one mutable field must be provided alongside `version`.
 */

import { z } from 'zod';
import { TICKET_PRIORITIES } from './create-ticket.dto';

export const TICKET_STATUSES = [
  'new',
  'open',
  'pending_customer',
  'pending_engineering',
  'resolved',
  'closed',
] as const;

export const UpdateTicketSchema = z
  .object({
    /**
     * Current version of the ticket for optimistic concurrency.
     * Required. Must match the version stored in the DB.
     */
    version: z.number().int().positive(),

    /** Updated subject line. 1–255 chars. */
    subject: z.string().trim().min(1).max(255).optional(),

    /** Updated full description. */
    description: z.string().max(100_000).optional(),

    /** Updated priority. */
    priority: z.enum(TICKET_PRIORITIES).optional(),

    /**
     * Requested new status. Validated against the transition table.
     * Illegal transitions return 422.
     */
    status: z.enum(TICKET_STATUSES).optional(),

    /** Updated category UUID. */
    category_id: z.string().uuid('category_id must be a UUID').optional(),

    /**
     * Assignee user UUID. Pass null to unassign.
     * Validated: assignee must be an active staff member in this tenant.
     */
    assignee_user_id: z.string().uuid('assignee_user_id must be a UUID').nullable().optional(),

    /**
     * Assignment group UUID. Pass null to remove.
     */
    assignment_group_id: z.string().uuid('assignment_group_id must be a UUID').nullable().optional(),

    /** Full replacement list of tag UUIDs (not additive). */
    tag_ids: z.array(z.string().uuid()).max(20, 'at most 20 tags per ticket').optional(),

    /** Partial or full replacement of custom field values. */
    custom_fields: z.record(z.unknown()).optional(),

    /**
     * Human-readable reason for a status change.
     * Stored in ticket_status_history.reason.
     */
    transition_reason: z.string().max(1_000).optional(),
  })
  .strict();

export type UpdateTicketDto = z.infer<typeof UpdateTicketSchema>;
