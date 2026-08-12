/**
 * CreatePortalTicketDto — WO-089.
 *
 * Strict Zod schema for POST /api/v1/portal/tickets.
 *
 * Differences from the agent CreateTicketSchema:
 *   - No organization_id (stamped server-side from the session principal)
 *   - No assignee_id / assignment_group_id (portal cannot set these)
 *   - requestedPriority is the customer-stated urgency (stored separately from
 *     the SLA-resolved effective priority)
 *   - attachmentIds array of pre-confirmed attachment UUIDs
 *   - .strict() rejects unknown properties with HTTP 400
 */

import { z } from 'zod';

export const PORTAL_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

export const CreatePortalTicketSchema = z
  .object({
    /** Display subject line. Required, 1–200 chars (tighter portal limit). */
    subject: z.string().trim().min(1, 'subject is required').max(200),

    /** Full request description. Required for portal submissions. */
    description: z.string().min(1, 'description is required').max(20_000),

    /**
     * Optional category UUID.
     * Validated server-side against tenant-owned categories.
     */
    categoryId: z.string().uuid('categoryId must be a UUID').optional(),

    /**
     * Priority the customer considers appropriate.
     * Stored as requested_priority; the effective SLA priority is resolved
     * server-side regardless of this value.
     */
    requestedPriority: z.enum(PORTAL_PRIORITIES).default('P3'),

    /**
     * Key–value custom fields validated server-side.
     * Unknown keys are rejected with 400.
     */
    customFields: z.record(z.unknown()).default({}),

    /**
     * UUIDs of confirmed attachments to link to this ticket.
     * Each ID is verified to belong to the authenticated portal user.
     * Maximum 10 attachments per ticket.
     */
    attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  })
  .strict();

export type CreatePortalTicketDto = z.infer<typeof CreatePortalTicketSchema>;
