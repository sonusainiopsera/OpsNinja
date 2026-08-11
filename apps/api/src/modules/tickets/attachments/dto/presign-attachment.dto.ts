/**
 * PresignAttachmentDto — request body for POST /api/v1/tickets/{id}/attachments/presign.
 */

import { z } from 'zod';

export const PresignAttachmentSchema = z
  .object({
    /** Original client-supplied filename. Sanitised server-side before storage. */
    filename: z.string().min(1, 'filename is required').max(1024),

    /**
     * Client-declared MIME type. Stored but later cross-checked against
     * magic bytes during finalization; mismatch → 422.
     */
    mime_type: z.string().min(1, 'mime_type is required').max(255),

    /**
     * Optional comment UUID to associate this attachment with.
     * When provided, the comment must belong to the same ticket.
     */
    comment_id: z.string().uuid('comment_id must be a UUID').optional(),
  })
  .strict();

export type PresignAttachmentDto = z.infer<typeof PresignAttachmentSchema>;
