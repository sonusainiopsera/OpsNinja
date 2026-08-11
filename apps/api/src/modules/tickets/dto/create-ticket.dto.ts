/**
 * CreateTicketDto — strict Zod schema for POST /api/v1/tickets.
 *
 * Security invariants:
 *   - .strict() rejects any unknown property with 400 VALIDATION_ERROR.
 *   - tenant_id is NEVER accepted from the request body; it is always stamped
 *     server-side from the authenticated principal.
 *   - subject is truncated at 255 characters — a DB error is never the first
 *     boundary enforcement.
 *   - custom_fields keys are validated against definitions at service layer.
 */

import { z } from 'zod';

export const TICKET_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const CreateTicketSchema = z
  .object({
    /** Display subject line. Required, 1–255 chars. */
    subject: z.string().trim().min(1, 'subject is required').max(255),

    /** Optional full description. PII-redacted in logs by the observability pipeline. */
    description: z.string().max(100_000).optional(),

    /** Priority level. Defaults to P3 (medium). */
    priority: z.enum(TICKET_PRIORITIES).default('P3'),

    /** UUID of the owning customer organisation. */
    organization_id: z.string().uuid('organization_id must be a UUID'),

    /**
     * UUID of the portal contact who submitted this ticket.
     * Required for portal principals (enforced at service layer).
     * Optional for agent-created tickets.
     */
    requester_contact_id: z.string().uuid('requester_contact_id must be a UUID').optional(),

    /**
     * Optional category UUID. Validated at service layer against
     * tenant-owned category definitions.
     */
    category_id: z.string().uuid('category_id must be a UUID').optional(),

    /** Optional array of tag UUIDs to apply. */
    tag_ids: z.array(z.string().uuid()).max(20, 'at most 20 tags per ticket').default([]),

    /**
     * Key–value map of tenant-defined custom field values.
     * Keys validated against custom_field_defs at service layer.
     * Unknown keys are rejected with 400.
     */
    custom_fields: z.record(z.unknown()).default({}),
  })
  .strict();

export type CreateTicketDto = z.infer<typeof CreateTicketSchema>;
