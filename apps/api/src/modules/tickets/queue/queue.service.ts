/**
 * QueueService — agent queue execution with Redis caching — WO-040.
 *
 * Responsibilities:
 *   1. Resolve view_id OR inline filter AST through ViewsService.compileView.
 *   2. Substitute principal placeholders (CURRENT_USER, CURRENT_ORG_SCOPE).
 *   3. Build the org-scope SQL predicate (appended AFTER the user filter;
 *      cannot be overridden by the filter AST).
 *   4. Check Redis page-one cache; serve from cache on hit.
 *   5. Execute QueueRepository.findPage on cache miss.
 *   6. Cache page-one result for 30 seconds.
 *
 * Cache key: queue:v1:{tenantId}:{signature}:{userId}:{scopeHash}:{sortKey}
 *
 * scopeHash = sha256(sorted orgScopeIds) — changes on every scope mutation so
 * stale results are never served after an agent's access is narrowed.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { inArray, eq } from 'drizzle-orm';

import type { PrincipalContext } from '../../../observability/request-context';
import { ViewsService } from '../../views/views.service';
import { ViewsRepository } from '../../views/views.repository';
import { RedisCacheService } from '../../../infra/cache/redis-cache';
import { QueueRepository, type QueuePage, type QueueRow } from './queue.repository';
import { encodeCursor, decodeCursor, type SortField, type CursorPayload } from './cursor';
import { DEFAULT_SORT, ParsedSortSchema, type QueueSortItem } from './queue.dto';
import type { CompiledPredicate } from '@opsninja/filter-compiler';

const CACHE_TTL_SECONDS = 30;
const CACHE_KEY_PREFIX = 'queue:v1';

/** Roles with tenant-wide access (no org-scope filter). */
const TENANT_WIDE_ROLES = new Set(['admin', 'lead_analyst']);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly queueRepo: QueueRepository,
    private readonly viewsService: ViewsService,
    private readonly viewsRepo: ViewsRepository,
    private readonly cache: RedisCacheService,
  ) {}

  // --------------------------------------------------------------------------
  // Public list API
  // --------------------------------------------------------------------------

  async listTickets(
    principal: PrincipalContext,
    opts: {
      viewId?: string;
      filterRaw?: string;
      sortRaw?: string;
      cursorEncoded?: string;
      limit: number;
    },
  ): Promise<{ page: QueuePage; next_cursor: string | null; cache_hit: boolean }> {
    // 1. Sort spec
    const sortSpec = parseSortSpec(opts.sortRaw);

    // 2. Compile filter
    const { compiledFilter, signature } = await this.resolveFilter(
      principal,
      opts.viewId,
      opts.filterRaw,
    );

    // 3. Decode cursor
    let cursor: CursorPayload | null = null;
    if (opts.cursorEncoded) {
      cursor = decodeCursor(opts.cursorEncoded, sortSpec);
    }

    // 4. Build org-scope predicate SQL
    const { scopeSql, scopeParams } = buildRawScopePredicate(principal);

    // 5. Cache check (page one only)
    const isFirstPage = !opts.cursorEncoded;
    if (isFirstPage) {
      const cacheKey = buildCacheKey(principal, signature, sortSpec);
      const cached = await this.cache.get<QueuePage>(cacheKey);
      if (cached) {
        this.logger.debug('Queue cache HIT', { cacheKey });
        return {
          page: cached,
          next_cursor: buildNextCursor(cached.rows, sortSpec, cached.hasMore),
          cache_hit: true,
        };
      }
    }

    // 6. Database query
    const page = await this.queueRepo.findPage(
      principal.tenantId,
      compiledFilter,
      scopeSql,
      scopeParams,
      sortSpec,
      cursor,
      opts.limit,
    );

    // 7. Cache page one
    if (isFirstPage) {
      const cacheKey = buildCacheKey(principal, signature, sortSpec);
      await this.cache.set(cacheKey, page, CACHE_TTL_SECONDS);
    }

    return {
      page,
      next_cursor: buildNextCursor(page.rows, sortSpec, page.hasMore),
      cache_hit: false,
    };
  }

  // --------------------------------------------------------------------------
  // Filter resolution helpers
  // --------------------------------------------------------------------------

  private async resolveFilter(
    principal: PrincipalContext,
    viewId?: string,
    filterRaw?: string,
  ): Promise<{ compiledFilter: CompiledPredicate | null; signature: string }> {
    if (viewId) {
      const view = await this.viewsRepo.findById(principal.tenantId, viewId);
      if (!view || !view.isActive) {
        throw new BadRequestException({
          error: { code: 'VIEW_NOT_FOUND', message: `View ${viewId} not found.` },
        });
      }
      if (view.scope === 'private' && view.ownerUserId !== principal.userId) {
        throw new BadRequestException({
          error: { code: 'VIEW_NOT_FOUND', message: `View ${viewId} not found.` },
        });
      }
      const compiled = this.viewsService.compileViewForPrincipal(view.filterAst, principal);
      return { compiledFilter: compiled.predicate, signature: compiled.cacheKey };
    }

    if (filterRaw) {
      let rawAst: unknown;
      try {
        rawAst = JSON.parse(filterRaw);
      } catch {
        throw new BadRequestException({
          error: { code: 'FILTER_INVALID_JSON', message: 'filter must be valid JSON.' },
        });
      }
      const compiled = this.viewsService.compileViewForPrincipal(rawAst, principal);
      return { compiledFilter: compiled.predicate, signature: compiled.cacheKey };
    }

    return { compiledFilter: null, signature: 'no-filter' };
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function parseSortSpec(sortRaw?: string): QueueSortItem[] {
  if (!sortRaw) return DEFAULT_SORT;
  try {
    const parsed = JSON.parse(sortRaw) as unknown;
    const result = ParsedSortSchema.safeParse(parsed);
    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: 'SORT_INVALID',
          message: 'Invalid sort specification.',
          details: result.error.errors,
        },
      });
    }
    return result.data;
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException({
      error: { code: 'SORT_INVALID_JSON', message: 'sort must be valid JSON.' },
    });
  }
}

/**
 * Convert principal's org scope into a raw SQL fragment + params array.
 * The scope predicate is always appended AFTER the compiled user filter so
 * it cannot be widened by the user-supplied AST.
 *
 * Returns sql='1=1' (no restriction) for tenant-wide roles.
 * Returns sql='false' (deny all) when the principal has an empty scope.
 */
function buildRawScopePredicate(principal: PrincipalContext): {
  scopeSql: string;
  scopeParams: unknown[];
} {
  // Portal principal: restrict to their single bound org
  if (principal.principalKind === 'portal') {
    const boundOrgId = principal.boundOrganizationId;
    if (!boundOrgId) return { scopeSql: 'false', scopeParams: [] };
    return { scopeSql: 't.organization_id = $1', scopeParams: [boundOrgId] };
  }

  // Tenant-wide roles: no org filter
  if (principal.roles.some((r) => TENANT_WIDE_ROLES.has(r))) {
    return { scopeSql: '1=1', scopeParams: [] };
  }

  // Machine principals: no org filter
  if (principal.principalKind === 'machine') {
    return { scopeSql: '1=1', scopeParams: [] };
  }

  const { orgScopeIds } = principal;

  // Empty scope: deny all
  if (orgScopeIds.length === 0) {
    return { scopeSql: 'false', scopeParams: [] };
  }

  // Build IN list (parameterized)
  const placeholders = orgScopeIds.map((_, i) => `$${i + 1}`).join(', ');
  return {
    scopeSql: `t.organization_id IN (${placeholders})`,
    scopeParams: orgScopeIds,
  };
}

function buildCacheKey(
  principal: PrincipalContext,
  signature: string,
  sortSpec: QueueSortItem[],
): string {
  const scopeHash = createHash('sha256')
    .update([...principal.orgScopeIds].sort().join(','))
    .digest('hex')
    .slice(0, 16);
  const sortKey = sortSpec.map((s) => `${s.field}:${s.direction}`).join(',');
  return `${CACHE_KEY_PREFIX}:${principal.tenantId}:${signature}:${principal.userId}:${scopeHash}:${sortKey}`;
}

function buildNextCursor(
  rows: QueueRow[],
  sortSpec: QueueSortItem[],
  hasMore: boolean,
): string | null {
  if (!hasMore || rows.length === 0) return null;
  const lastRow = rows[rows.length - 1]!;
  const rowForCursor: Record<string, unknown> & { id: string } = { id: lastRow.id };
  for (const s of sortSpec) {
    rowForCursor[s.field] = (lastRow as unknown as Record<string, unknown>)[s.field] ?? null;
  }
  return encodeCursor(sortSpec, rowForCursor);
}
