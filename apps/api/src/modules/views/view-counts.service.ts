/**
 * ViewCountsService — per-view ticket counts for the views rail — WO-040.
 *
 * Returns { view_id, count, exact } for each visible view.
 * Each count uses the view's compiled filter plus the principal's org-scope
 * predicate, ensuring counts and queue rows never disagree.
 *
 * Bounded COUNT: uses a 3-second statement timeout per view. On timeout the
 * count falls back to an approximate pg_class.reltuples estimate (exact=false).
 *
 * Results are cached for 30 seconds under:
 *   viewcounts:v1:{tenantId}:{userId}:{scopeHash}
 *
 * The cache key includes the scope hash so a scope change invalidates counts
 * immediately, consistent with the queue cache key strategy.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';

import type { PrincipalContext } from '../../observability/request-context';
import { TenantRepository } from '../../data/tenant-repository';
import { RedisCacheService } from '../../infra/cache/redis-cache';
import { ViewsService } from './views.service';
import { ViewsRepository } from './views.repository';

const CACHE_TTL_SECONDS = 30;
const COUNT_STATEMENT_TIMEOUT = '3s';

export interface ViewCountResult {
  view_id: string;
  count: number;
  exact: boolean;
}

/** Roles with tenant-wide access (no org-scope restriction). */
const TENANT_WIDE_ROLES = new Set(['admin', 'lead_analyst']);

// ---------------------------------------------------------------------------
// Repository helper (inline — avoids a separate class for one method)
// ---------------------------------------------------------------------------

class CountRepository extends TenantRepository {
  async countWithFilter(
    tenantId: string,
    filterSql: string,
    filterParams: unknown[],
    scopeSql: string,
    scopeParams: unknown[],
  ): Promise<{ count: number; exact: boolean }> {
    // Build final params list: tenantId + filter params + scope params
    const params: unknown[] = [tenantId, ...filterParams];

    // Rebase scope params (they use $1..$N relative; offset by filter params)
    let rebasedScopeSql = scopeSql;
    if (scopeParams.length > 0) {
      const offset = params.length;
      params.push(...scopeParams);
      rebasedScopeSql = scopeSql.replace(
        /\$(\d+)/g,
        (_, n: string) => `$${parseInt(n, 10) + offset}`,
      );
    }

    // Rebase filter params (they use $1..$N relative; offset by tenantId param)
    const rebasedFilterSql = filterSql
      ? filterSql.replace(/\$(\d+)/g, (_, n: string) => `$${parseInt(n, 10) + 1}`)
      : '1=1';

    try {
      await this.tx.execute(
        sql.raw(`SET LOCAL statement_timeout = '${COUNT_STATEMENT_TIMEOUT}'`),
      );

      const querySql = `
        SELECT COUNT(*)::bigint AS cnt
        FROM tickets t
        WHERE t.tenant_id = $1::uuid
          AND (${rebasedFilterSql})
          AND (${rebasedScopeSql})
      `;

      const result = await this.tx.execute(sql.raw(querySql, params as never[]));
      const rows = (result as unknown as { rows: Array<{ cnt: string }> }).rows;
      const cnt = parseInt(rows[0]?.cnt ?? '0', 10);

      await this.tx.execute(sql.raw(`SET LOCAL statement_timeout = DEFAULT`));
      return { count: cnt, exact: true };
    } catch {
      // Timeout or error — use reltuples approximation
      try {
        const approx = await this.tx.execute(
          sql.raw(`SELECT reltuples::bigint AS e FROM pg_class WHERE relname = 'tickets'`),
        );
        const rows = (approx as unknown as { rows: Array<{ e: string }> }).rows;
        return { count: Math.max(parseInt(rows[0]?.e ?? '0', 10), 0), exact: false };
      } catch {
        return { count: 0, exact: false };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ViewCountsService {
  private readonly logger = new Logger(ViewCountsService.name);
  private readonly countRepo: CountRepository;

  constructor(
    private readonly viewsService: ViewsService,
    private readonly viewsRepo: ViewsRepository,
    private readonly cache: RedisCacheService,
  ) {
    this.countRepo = new CountRepository();
  }

  async getCounts(principal: PrincipalContext): Promise<ViewCountResult[]> {
    const cacheKey = buildCountCacheKey(principal);
    const cached = await this.cache.get<ViewCountResult[]>(cacheKey);
    if (cached) return cached;

    // Load all views visible to this principal
    const views = await this.viewsRepo.findVisibleToUser(
      principal.tenantId,
      principal.userId,
    );

    // Org-scope SQL (same logic as QueueService)
    const { scopeSql, scopeParams } = buildRawScopePredicate(principal);

    // Count each view in parallel (bounded by statement timeout)
    const results = await Promise.all(
      views.map(async (view): Promise<ViewCountResult> => {
        try {
          const compiled = this.viewsService.compileViewForPrincipal(
            view.filterAst,
            principal,
          );

          const { count, exact } = await this.countRepo.countWithFilter(
            principal.tenantId,
            compiled.predicate.sql,
            compiled.predicate.params,
            scopeSql,
            scopeParams,
          );

          return { view_id: view.id, count, exact };
        } catch (err) {
          this.logger.warn('Failed to count view', {
            viewId: view.id,
            message: (err as Error).message,
          });
          return { view_id: view.id, count: 0, exact: false };
        }
      }),
    );

    await this.cache.set(cacheKey, results, CACHE_TTL_SECONDS);
    return results;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCountCacheKey(principal: PrincipalContext): string {
  const scopeHash = createHash('sha256')
    .update([...principal.orgScopeIds].sort().join(','))
    .digest('hex')
    .slice(0, 16);
  return `viewcounts:v1:${principal.tenantId}:${principal.userId}:${scopeHash}`;
}

function buildRawScopePredicate(principal: PrincipalContext): {
  scopeSql: string;
  scopeParams: unknown[];
} {
  if (principal.principalKind === 'portal') {
    const boundOrgId = principal.boundOrganizationId;
    if (!boundOrgId) return { scopeSql: 'false', scopeParams: [] };
    return { scopeSql: 't.organization_id = $1', scopeParams: [boundOrgId] };
  }
  if (principal.roles.some((r) => TENANT_WIDE_ROLES.has(r))) {
    return { scopeSql: '1=1', scopeParams: [] };
  }
  if (principal.principalKind === 'machine') {
    return { scopeSql: '1=1', scopeParams: [] };
  }
  const { orgScopeIds } = principal;
  if (orgScopeIds.length === 0) return { scopeSql: 'false', scopeParams: [] };
  const placeholders = orgScopeIds.map((_, i) => `$${i + 1}`).join(', ');
  return { scopeSql: `t.organization_id IN (${placeholders})`, scopeParams: orgScopeIds };
}
