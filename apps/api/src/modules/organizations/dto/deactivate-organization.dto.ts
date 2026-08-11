import { z } from 'zod';

/**
 * DTO for POST /api/v1/organizations/{id}/deactivate.
 *
 * confirmName prevents misclicks from the UI propagating to the API.
 * The caller must echo the exact organization name as displayed.
 */
export const DeactivateOrganizationSchema = z
  .object({
    /**
     * Must exactly match organizations.name (case-sensitive).
     * Returns 400 on mismatch without mutating any row.
     */
    confirmName: z.string().min(1).max(200),
    /** Mandatory reason for audit record. Max 500 chars. */
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type DeactivateOrganizationDto = z.infer<typeof DeactivateOrganizationSchema>;
