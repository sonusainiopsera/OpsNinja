/**
 * FinalizeAttachmentDto — request body for POST /api/v1/tickets/{id}/attachments/finalize.
 */

import { z } from 'zod';

export const FinalizeAttachmentSchema = z
  .object({
    /** UUID of the attachment row created by the presign endpoint. */
    attachment_id: z.string().uuid('attachment_id must be a UUID'),
  })
  .strict();

export type FinalizeAttachmentDto = z.infer<typeof FinalizeAttachmentSchema>;
