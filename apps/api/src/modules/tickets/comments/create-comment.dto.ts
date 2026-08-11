/**
 * CreateCommentDto — strict Zod schema for POST /api/v1/tickets/{id}/comments.
 *
 * Security invariants:
 *   - .strict() rejects any unknown property with 400 VALIDATION_ERROR.
 *   - Portal principals cannot set visibility=internal; the service enforces this.
 *   - Body is stored as-is; HTML encoding happens at render time on the client.
 *   - Empty or whitespace-only bodies are rejected with 400.
 *   - tenant_id, author_id, ticket_id are NEVER accepted from the request body.
 */

import { z } from 'zod';

export const COMMENT_VISIBILITIES = ['public', 'internal'] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export const CreateCommentSchema = z
  .object({
    /**
     * Comment body. Stored verbatim; rendered with a sanitising markdown
     * renderer on the client. 1–64_000 characters.
     */
    body: z.string().trim().min(1, 'body is required').max(64_000),

    /**
     * Visibility of the comment.
     *   public   — visible to portal users and agents.
     *   internal — agents and staff only; structurally hidden from portal.
     *
     * Defaults to 'public'. Portal principals may only post 'public' comments;
     * specifying 'internal' from the portal returns 403 (enforced in service).
     */
    visibility: z.enum(COMMENT_VISIBILITIES).default('public'),

    /**
     * Optional attachment UUIDs to associate with this comment.
     * Attachment ownership is validated at service layer (tenant + ticket scope).
     */
    attachment_ids: z.array(z.string().uuid()).max(10).default([]),
  })
  .strict();

export type CreateCommentDto = z.infer<typeof CreateCommentSchema>;
