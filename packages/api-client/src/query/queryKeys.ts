/**
 * Query key factory for TanStack Query v5.
 *
 * Keys embed tenantId and orgScopeVersion so a scope change invalidates
 * all cached data rather than silently reusing stale results.
 */

export interface ScopeContext {
  tenantId: string;
  orgScopeVersion: number;
}

export const queryKeys = {
  /**
   * Root key for all queries under a specific scope context.
   * Invalidating this key clears ALL data for the scope.
   */
  all: (ctx: ScopeContext) => [ctx.tenantId, ctx.orgScopeVersion] as const,

  tickets: {
    all: (ctx: ScopeContext) => [...queryKeys.all(ctx), 'tickets'] as const,
    list: (ctx: ScopeContext, filters?: Record<string, unknown>) =>
      [...queryKeys.tickets.all(ctx), 'list', filters] as const,
    detail: (ctx: ScopeContext, ticketId: string) =>
      [...queryKeys.tickets.all(ctx), 'detail', ticketId] as const,
  },

  agents: {
    all: (ctx: ScopeContext) => [...queryKeys.all(ctx), 'agents'] as const,
    list: (ctx: ScopeContext, filters?: Record<string, unknown>) =>
      [...queryKeys.agents.all(ctx), 'list', filters] as const,
    detail: (ctx: ScopeContext, agentId: string) =>
      [...queryKeys.agents.all(ctx), 'detail', agentId] as const,
  },

  organizations: {
    all: (ctx: ScopeContext) => [...queryKeys.all(ctx), 'organizations'] as const,
    list: (ctx: ScopeContext) => [...queryKeys.organizations.all(ctx), 'list'] as const,
    detail: (ctx: ScopeContext, orgId: string) =>
      [...queryKeys.organizations.all(ctx), 'detail', orgId] as const,
  },

  auth: {
    me: (tenantId: string) => [tenantId, 'auth', 'me'] as const,
    scope: (tenantId: string) => [tenantId, 'auth', 'scope'] as const,
  },
};
