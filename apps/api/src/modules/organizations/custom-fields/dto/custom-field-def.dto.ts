/**
 * DTOs for custom field definition management (WO-026).
 *
 * All schemas are strict (unknown keys rejected).
 *
 * field_key rules:
 *   - Lower snake_case: starts with a lowercase letter, followed by
 *     lowercase letters, digits, or underscores.
 *   - Length: 2–64 characters.
 *   - Reserved prefix 'sys_' is rejected.
 *
 * These rules are enforced both here (for external API inputs) and in
 * CustomFieldDefsService (for programmatic calls).
 */

import { z } from 'zod';

export const DATA_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'single_select',
  'multi_select',
] as const;

export type DataType = (typeof DATA_TYPES)[number];

// ---------------------------------------------------------------------------
// field_key validator (shared between create and constraints DTOs)
// ---------------------------------------------------------------------------

export const FIELD_KEY_REGEX = /^[a-z][a-z0-9_]{1,63}$/;
export const RESERVED_KEY_PREFIXES = ['sys_'];

export const fieldKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(FIELD_KEY_REGEX, 'field_key must be lower snake_case (letters, digits, underscores)')
  .refine(
    (k) => !RESERVED_KEY_PREFIXES.some((p) => k.startsWith(p)),
    { message: 'field_key must not use reserved prefixes (sys_)' },
  );

// ---------------------------------------------------------------------------
// Constraints sub-schema (per-type)
// ---------------------------------------------------------------------------

export const FieldConstraintsSchema = z
  .object({
    /** string: maximum character length */
    maxLength: z.number().int().positive().optional(),
    /** string: full-match regular expression */
    regex: z.string().min(1).max(256).optional(),
    /** number: inclusive lower bound */
    min: z.number().optional(),
    /** number: inclusive upper bound */
    max: z.number().optional(),
    /** number: must be a whole number */
    integer: z.boolean().optional(),
    /** multi_select: maximum selected item count (post-dedup) */
    maxItems: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

// ---------------------------------------------------------------------------
// POST /organizations/custom-fields — create a new definition
// ---------------------------------------------------------------------------

export const CreateCustomFieldDefSchema = z
  .object({
    fieldKey: fieldKeySchema,
    label: z.string().trim().min(1).max(200),
    dataType: z.enum(DATA_TYPES),
    required: z.boolean().default(false),
    /**
     * Required for single_select / multi_select; must have ≥ 1 distinct option.
     * Forbidden for other types.
     */
    options: z.array(z.string().min(1).max(200)).min(1).max(200).optional(),
    constraints: FieldConstraintsSchema,
    appliesTo: z.string().trim().min(1).max(64).default('organization'),
    displayOrder: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const selectTypes = ['single_select', 'multi_select'] as const;
    const needsOptions = (selectTypes as readonly string[]).includes(v.dataType);
    if (needsOptions && (!v.options || v.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'options is required for single_select and multi_select field types',
      });
    }
    if (!needsOptions && v.options) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'options must not be provided for non-select field types',
      });
    }
    // Validate regex compiles if provided
    if (v.constraints?.regex) {
      try {
        new RegExp(v.constraints.regex);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['constraints', 'regex'],
          message: 'constraints.regex is not a valid regular expression',
        });
      }
    }
    // Validate min <= max if both present
    if (
      v.constraints?.min !== undefined &&
      v.constraints?.max !== undefined &&
      v.constraints.min > v.constraints.max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['constraints'],
        message: 'constraints.min must not exceed constraints.max',
      });
    }
  });

export type CreateCustomFieldDefDto = z.infer<typeof CreateCustomFieldDefSchema>;

// ---------------------------------------------------------------------------
// PATCH /organizations/custom-fields/:id — update a definition
// ---------------------------------------------------------------------------

/**
 * Mutable fields: label, required, options (additive only — see service),
 * constraints, displayOrder.
 * Immutable: fieldKey, dataType, appliesTo.
 * The service rejects fieldKey in the body with 422 FIELD_KEY_IMMUTABLE.
 */
export const UpdateCustomFieldDefSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    required: z.boolean().optional(),
    /**
     * Additive-only: new options may be added but existing ones may not be
     * removed (the service enforces this). Attempting to remove an option that
     * is referenced by stored values returns 409 OPTION_IN_USE.
     */
    options: z.array(z.string().min(1).max(200)).min(1).max(200).optional(),
    constraints: FieldConstraintsSchema,
    displayOrder: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.constraints?.regex) {
      try {
        new RegExp(v.constraints.regex);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['constraints', 'regex'],
          message: 'constraints.regex is not a valid regular expression',
        });
      }
    }
    if (
      v.constraints?.min !== undefined &&
      v.constraints?.max !== undefined &&
      v.constraints.min > v.constraints.max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['constraints'],
        message: 'constraints.min must not exceed constraints.max',
      });
    }
  });

export type UpdateCustomFieldDefDto = z.infer<typeof UpdateCustomFieldDefSchema>;

// ---------------------------------------------------------------------------
// PUT /organizations/custom-fields/reorder — batch reorder
// ---------------------------------------------------------------------------

export const ReorderCustomFieldDefsSchema = z
  .object({
    /** Ordered array of definition IDs; all must belong to this tenant. */
    ids: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

export type ReorderCustomFieldDefsDto = z.infer<typeof ReorderCustomFieldDefsSchema>;

// ---------------------------------------------------------------------------
// PUT /organizations/:id/custom-fields — write org metadata values
// ---------------------------------------------------------------------------

export const PutCustomFieldValuesSchema = z
  .object({
    /**
     * Current organisation version for optimistic concurrency.
     * A mismatch returns 409 ORGANIZATION_VERSION_CONFLICT.
     */
    version: z.number().int().positive(),
    values: z.record(z.unknown()),
  })
  .strict();

export type PutCustomFieldValuesDto = z.infer<typeof PutCustomFieldValuesSchema>;
