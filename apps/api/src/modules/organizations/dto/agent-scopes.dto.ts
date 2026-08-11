import { z } from 'zod';

const ACCESS_LEVEL = z.enum(['full', 'read_only']);

export const AgentScopeEntrySchema = z.object({
  organization_id: z.string().uuid('organization_id must be a valid UUID'),
  access_level: ACCESS_LEVEL.default('full'),
});

export const PutAgentScopesSchema = z.object({
  scopes: z
    .array(AgentScopeEntrySchema)
    .max(500, 'Cannot assign more than 500 organizations at once'),
}).superRefine((data, ctx) => {
  const ids = data.scopes.map((s) => s.organization_id);
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dups.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate organization_id(s): ${[...new Set(dups)].join(', ')}`,
    });
  }
});

export type AgentScopeEntry = z.infer<typeof AgentScopeEntrySchema>;
export type PutAgentScopesDto = z.infer<typeof PutAgentScopesSchema>;

// Response shapes
export interface AgentScopesResponse {
  user_id: string;
  scope_version: number;
  organizations: Array<{
    organization_id: string;
    name: string;
    access_level: string;
  }>;
}

export interface PutAgentScopesResponse {
  user_id: string;
  scope_version: number;
}
