import { z } from 'zod';
import { SLA_TIERS, ORG_REGIONS } from './create-organization.dto';

const CUSTOM_FIELDS_MAX_BYTES = 32_768;

/**
 * DTO for PATCH /api/v1/organizations/:id.
 *
 * Requires `version` for optimistic-concurrency control.
 * Returns 409 ORGANIZATION_VERSION_CONFLICT when supplied version doesn't match.
 *
 * Strict schema — unknown properties are rejected.
 */
export const UpdateOrganizationSchema = z
  .object({
    /**
     * Current version of the record. Must match the server-side version.
     * Returns 409 ORGANIZATION_VERSION_CONFLICT if stale.
     */
    version: z.number().int().positive(),
    /** Updated display name. Max 200 chars. */
    name: z.string().trim().min(1).max(200).optional(),
    /** Updated SLA tier. */
    slaTier: z.enum(SLA_TIERS).optional(),
    /** Updated region. */
    region: z.enum(ORG_REGIONS).optional(),
    /**
     * Full replacement of custom field values. Max 32 KB serialised.
     * Send the entire map — this is not a merge/patch of individual keys.
     */
    customFieldValues: z
      .record(z.unknown())
      .optional()
      .refine(
        (v) => v === undefined || JSON.stringify(v).length <= CUSTOM_FIELDS_MAX_BYTES,
        { message: `customFieldValues must not exceed ${CUSTOM_FIELDS_MAX_BYTES / 1024} KB` },
      ),
  })
  .strict();

export type UpdateOrganizationDto = z.infer<typeof UpdateOrganizationSchema>;
