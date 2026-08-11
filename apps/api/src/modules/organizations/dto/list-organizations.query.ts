import { z } from 'zod';
import { SLA_TIERS, ORG_REGIONS } from './create-organization.dto';

/** Default page size. */
export const DEFAULT_LIMIT = 25;
/** Maximum page size cap. */
export const MAX_LIMIT = 100;

/**
 * Query-string DTO for GET /api/v1/organizations.
 *
 * All filters are optional and combinable. Pagination uses an opaque cursor.
 */
export const ListOrganizationsQuerySchema = z
  .object({
    /** Opaque keyset cursor returned by the previous page. */
    cursor: z.string().optional(),
    /**
     * Number of records to return. Defaults to 25, hard-capped at 100.
     * Values outside [1, 100] are clamped.
     */
    limit: z
      .string()
      .optional()
      .transform((v) => {
        const n = v === undefined ? DEFAULT_LIMIT : parseInt(v, 10);
        if (isNaN(n) || n < 1) return 1;
        return Math.min(n, MAX_LIMIT);
      }),
    /** Filter by SLA tier. */
    tier: z.enum(SLA_TIERS).optional(),
    /** Filter by deployment region. */
    region: z.enum(ORG_REGIONS).optional(),
    /** Filter by lifecycle status. */
    status: z.enum(['active', 'inactive']).optional(),
    /**
     * Free-text search across name and slug (case-insensitive ILIKE).
     * SQL wildcards (%, _) in the search term are treated as literals.
     */
    q: z.string().trim().max(200).optional(),
    /**
     * JSONB containment filter on custom_field_values.
     * Format: "fieldKey:value"  e.g. "cloudProvider:aws"
     *
     * Translates to:  custom_field_values @> '{"cloudProvider":"aws"}'::jsonb
     * Uses the GIN index created in migration 0005.
     *
     * Only string values are supported via the query-string format; for complex
     * types use the reporting API.
     */
    customField: z
      .string()
      .trim()
      .max(400)
      .refine(
        (v) => {
          const colon = v.indexOf(':');
          return colon > 0 && colon < v.length - 1;
        },
        { message: 'customField must be in "fieldKey:value" format' },
      )
      .optional(),
  })
  .strict();

export type ListOrganizationsQuery = z.infer<typeof ListOrganizationsQuerySchema>;
