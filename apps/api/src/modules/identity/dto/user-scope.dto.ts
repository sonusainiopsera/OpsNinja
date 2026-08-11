import { z } from 'zod';

/**
 * Request body schema for PUT /api/v1/users/:userId/org-scope.
 *
 * tenantWide: when true, all scope rows are removed and the user gets
 *   unrestricted access within the tenant (used for admin/manager role grants).
 *   When false (default), organizationIds must be provided.
 *
 * organizationIds: full-replacement list of organization UUIDs to assign.
 *   Silently deduplicated. Must all belong to the caller's tenant.
 */
export const PutUserOrgScopeSchema = z.object({
  tenantWide: z.boolean().optional().default(false),
  organizationIds: z
    .array(z.string().uuid('Each organizationId must be a valid UUID'))
    .max(500, 'Cannot assign more than 500 organizations at once')
    .default([]),
}).superRefine((data, ctx) => {
  if (!data.tenantWide && data.organizationIds.length === 0) {
    // Valid: represents zero org access (deny-all predicate).
    return;
  }
  const ids = data.organizationIds;
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dups.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['organizationIds'],
      message: `Duplicate organizationId(s): ${[...new Set(dups)].join(', ')}`,
    });
  }
});

export type PutUserOrgScopeDto = z.infer<typeof PutUserOrgScopeSchema>;

/** GET /api/v1/users/:userId/org-scope response shape. */
export interface GetUserOrgScopeResponse {
  userId: string;
  /** true when the user has no scope rows (effectively unrestricted within tenant). */
  tenantWide: boolean;
  organizationIds: string[];
  scopeVersion: number;
}

/** PUT /api/v1/users/:userId/org-scope response shape. */
export interface PutUserOrgScopeResponse {
  scopeVersion: number;
  /** Organization IDs added by this mutation. */
  added: string[];
  /** Organization IDs removed by this mutation. */
  removed: string[];
}
