import { z } from 'zod';

/**
 * DTO for POST /api/v1/organizations/{id}/reactivate.
 */
export const ReactivateOrganizationSchema = z
  .object({
    /** Mandatory reason for audit record. Max 500 chars. */
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type ReactivateOrganizationDto = z.infer<typeof ReactivateOrganizationSchema>;
