/**
 * Query key factory for TanStack Query.
 *
 * Keys embed tenantId and orgScopeVersion so cached data cannot be
 * reused across a scope change. When orgScopeVersion bumps, all keys
 * for that tenant become stale and queries are re-fetched.
 *
 * Convention: ['opsninja', tenantId, orgScopeVersion, ...resource, ...params]
 */

export interface QueryContext {
  tenantId: string;
  orgScopeVersion: number;
}

const ROOT = 'opsninja' as const;

function base(ctx: QueryContext): [typeof ROOT, string, number] {
  return [ROOT, ctx.tenantId, ctx.orgScopeVersion];
}

export const queryKeys = {
  /** All keys for a tenant+scope — invalidate everything after scope change. */
  all: (ctx: QueryContext) => base(ctx),

  tickets: {
    all: (ctx: QueryContext) => [...base(ctx), 'tickets'] as const,
    list: (ctx: QueryContext, params?: Record<string, unknown>) =>
      [...base(ctx), 'tickets', 'list', params ?? {}] as const,
    detail: (ctx: QueryContext, ticketId: string) =>
      [...base(ctx), 'tickets', 'detail', ticketId] as const,
  },

  organizations: {
    all: (ctx: QueryContext) => [...base(ctx), 'organizations'] as const,
    list: (ctx: QueryContext, params?: Record<string, unknown>) =>
      [...base(ctx), 'organizations', 'list', params ?? {}] as const,
    detail: (ctx: QueryContext, orgId: string) =>
      [...base(ctx), 'organizations', 'detail', orgId] as const,
  },

  users: {
    all: (ctx: QueryContext) => [...base(ctx), 'users'] as const,
    list: (ctx: QueryContext, params?: Record<string, unknown>) =>
      [...base(ctx), 'users', 'list', params ?? {}] as const,
    detail: (ctx: QueryContext, userId: string) =>
      [...base(ctx), 'users', 'detail', userId] as const,
    orgScope: (ctx: QueryContext, userId: string) =>
      [...base(ctx), 'users', 'org-scope', userId] as const,
  },

  reports: {
    all: (ctx: QueryContext) => [...base(ctx), 'reports'] as const,
    list: (ctx: QueryContext, params?: Record<string, unknown>) =>
      [...base(ctx), 'reports', 'list', params ?? {}] as const,
  },
};
