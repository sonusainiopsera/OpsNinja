/**
 * Jira mapping Zod schemas — WO-052.
 *
 * These schemas are the single source of truth for what is stored in
 * field_map, status_map and sync_rules JSONB columns.  Only allow-listed
 * source attributes are accepted — free-text expressions are prohibited.
 *
 * Validation is performed at write time so stored mappings can never become
 * runtime injection or crash vectors in the sync workers.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Allow-listed OpsNinja source attributes
// ---------------------------------------------------------------------------

export const MAPPING_SOURCES = [
  'ticket.title',
  'ticket.description',
  'ticket.priority',
  'ticket.category_path',
  'ticket.organization_name',
  'ticket.url',
  'static',
] as const;

export type MappingSource = (typeof MAPPING_SOURCES)[number];

export const MAPPING_TRANSFORMS = [
  'priority_to_jira',
  'status_to_jira',
  'none',
] as const;

export type MappingTransform = (typeof MAPPING_TRANSFORMS)[number];

// ---------------------------------------------------------------------------
// OpsNinja ticket statuses (must match tickets module's status enum)
// ---------------------------------------------------------------------------

export const OPSNINJA_STATUSES = [
  'open',
  'in_progress',
  'pending_customer_input',
  'on_hold',
  'resolved',
  'closed',
] as const;

export type OpsninjaStatus = (typeof OPSNINJA_STATUSES)[number];

// ---------------------------------------------------------------------------
// FieldMapEntry schema
// ---------------------------------------------------------------------------

const fieldMapEntrySchema = z
  .object({
    source: z.enum(MAPPING_SOURCES, {
      errorMap: () => ({
        message: `source must be one of: ${MAPPING_SOURCES.join(', ')}`,
      }),
    }),
    staticValue: z.string().optional(),
    target: z.object({
      fieldId: z.string().min(1, 'fieldId is required'),
      schemaType: z.string().min(1, 'schemaType is required'),
    }),
    transform: z.enum(MAPPING_TRANSFORMS).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.source === 'static' && !val.staticValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'staticValue is required when source is "static"',
        path: ['staticValue'],
      });
    }
    if (val.source !== 'static' && val.staticValue !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'staticValue must only be set when source is "static"',
        path: ['staticValue'],
      });
    }
  });

export type FieldMapEntryDto = z.infer<typeof fieldMapEntrySchema>;

// ---------------------------------------------------------------------------
// StatusMapEntry schema
// ---------------------------------------------------------------------------

const statusMapEntrySchema = z
  .object({
    jiraStatusId: z.string().optional(),
    jiraStatusCategory: z.string().optional(),
    opsninjaStatus: z.enum(OPSNINJA_STATUSES, {
      errorMap: () => ({
        message: `opsninjaStatus must be one of: ${OPSNINJA_STATUSES.join(', ')}`,
      }),
    }),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.jiraStatusId && !val.jiraStatusCategory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of jiraStatusId or jiraStatusCategory must be provided',
        path: ['jiraStatusId'],
      });
    }
  });

export type StatusMapEntryDto = z.infer<typeof statusMapEntrySchema>;

// ---------------------------------------------------------------------------
// SyncRules schema
// ---------------------------------------------------------------------------

const syncRulesSchema = z
  .object({
    applyInboundStatus: z.boolean().default(true),
    applyInboundComments: z.boolean().default(true),
    autoResolveOnJiraDone: z.boolean().default(false),
    commentVisibility: z.enum(['public', 'internal']).default('internal'),
    /**
     * Optional routing criteria used by JiraMappingResolver.
     * When present, this mapping is preferred over the default for tickets
     * whose category path or organisation ID matches.
     */
    categoryPaths: z.array(z.string()).optional(),
    organizationIds: z.array(z.string().uuid()).optional(),
  });

export type SyncRulesDto = z.infer<typeof syncRulesSchema>;

// ---------------------------------------------------------------------------
// Create / Update mapping DTO
// ---------------------------------------------------------------------------

export const CreateMappingSchema = z
  .object({
    connectionId: z.string().uuid(),
    projectKey: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]+$/, 'projectKey must be uppercase alphanumeric'),
    projectId: z.string().min(1),
    defaultIssueTypeId: z.string().min(1),
    fieldMap: z.array(fieldMapEntrySchema).max(50),
    statusMap: z.array(statusMapEntrySchema).max(50),
    syncRules: syncRulesSchema.optional().default({
      applyInboundStatus: true,
      applyInboundComments: true,
      autoResolveOnJiraDone: false,
      commentVisibility: 'internal',
    }),
    isDefault: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .strict();

export type CreateMappingDto = z.infer<typeof CreateMappingSchema>;

export const UpdateMappingSchema = CreateMappingSchema.omit({ connectionId: true }).partial().strict();

export type UpdateMappingDto = z.infer<typeof UpdateMappingSchema>;

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

export const ListMappingsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Math.max(parseInt(v ?? '25', 10), 1), 100))
    .default('25'),
  cursor: z.string().optional(),
  connectionId: z.string().uuid().optional(),
});

export type ListMappingsQueryDto = z.infer<typeof ListMappingsQuerySchema>;

export const DiscoveryQuerySchema = z.object({
  refresh: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  issueTypeId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Math.max(parseInt(v ?? '50', 10), 1), 200))
    .default('50'),
});

export type DiscoveryQueryDto = z.infer<typeof DiscoveryQuerySchema>;
