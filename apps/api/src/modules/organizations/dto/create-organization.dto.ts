import { z } from 'zod';

/** Maximum size (bytes) for custom_field_values JSON payload. */
const CUSTOM_FIELDS_MAX_BYTES = 32_768; // 32 KB

export const SLA_TIERS = ['standard', 'premium', 'enterprise'] as const;
export type SlaTier = (typeof SLA_TIERS)[number];

export const ORG_REGIONS = [
  'us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1',
  'ap-southeast-1', 'ap-northeast-1',
] as const;
export type OrgRegion = (typeof ORG_REGIONS)[number];

/**
 * DTO for POST /api/v1/organizations.
 *
 * Strict schema — unknown properties are rejected.
 * name uniqueness (per active tenant) is enforced at the service layer.
 */
export const CreateOrganizationSchema = z
  .object({
    /** Display name. Max 200 chars. Must be unique among active orgs per tenant. */
    name: z.string().trim().min(1).max(200),
    /**
     * Optional URL-safe slug. If omitted the service generates one from name.
     * Pattern: lowercase alphanumeric + hyphens.
     */
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens')
      .optional(),
    /** SLA tier for this organisation. Default 'standard'. */
    slaTier: z.enum(SLA_TIERS).default('standard'),
    /** Deployment region. Optional. */
    region: z.enum(ORG_REGIONS).optional(),
    /**
     * Arbitrary key-value map of custom fields. Max 32 KB serialised.
     * Keys are validated against custom_field_defs at the service layer.
     */
    customFieldValues: z
      .record(z.unknown())
      .default({})
      .refine(
        (v) => JSON.stringify(v).length <= CUSTOM_FIELDS_MAX_BYTES,
        { message: `customFieldValues must not exceed ${CUSTOM_FIELDS_MAX_BYTES / 1024} KB` },
      ),
  })
  .strict();

export type CreateOrganizationDto = z.infer<typeof CreateOrganizationSchema>;
