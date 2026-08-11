/**
 * QueueRepository — single-query ticket queue execution — WO-040.
 *
 * Composes one SQL statement from:
 *   1. Base SELECT on tickets (t) with LEFT JOIN to organizations
 *   2. Lateral json_agg subquery for tags (up to 20 per ticket)
 *   3. Compiled user filter predicate (from filter-compiler)
 *   4. Organisation-scope predicate (enforced after user filter)
 *   5. Keyset cursor predicate (when paginating)
 *   6. ORDER BY sort spec + id tiebreaker
 *   7. LIMIT n+1 (to detect hasMore)
 *
 * The total_estimate uses a capped COUNT with a 3-second statement timeout;
 * on timeout it falls back to the pg_class reltuples approximation.
 *
 * Uses raw SQL via Drizzle's sql-tagged template to handle the complex lateral
 * joins and dynamic predicate composition without N+1 queries.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { TenantRepository } from '../../../data/tenant-repository';
import type { CompiledPredicate } from '@opsninja/filter-compiler';
import type { QueueSortItem } from './queue.dto';
import { buildCursorPredicate, buildOrderByClause, type CursorPayload } from './cursor';
import type { SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueueRow {
  id: string;
  ticket_number: number | null;
  subject: string;
  status: string;
  priority: string;
  ai_status: string | null;
  updated_at: string;
  created_at: string;
  resolved_at: string | null;
  // Denormalised joins
  organization: { id: string; name: string } | null;
  assignee: { id: string } | null;
  tags: Array<{ id: string; name: string; color: string | null }>;
  // Placeholders for future WOs
  category: null;
  sla: null;
  has_jira_link: boolean;
}

export interface TotalEstimate {
  value: number;
  exact: boolean;
}

export interface QueuePage {
  rows: QueueRow[];
  hasMore: boolean;
  totalEstimate: TotalEstimate;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class QueueRepository extends TenantRepository {
  private readonly logger = new Logger(QueueRepository.name);

  /**
   * Execute a queue page query.
   *
   * @param tenantId         Current tenant.
   * @param compiledFilter   Pre-compiled user filter predicate (null = no filter).
   * @param scopeSql         Org-scope predicate fragment (null = tenant-wide).
   * @param sortSpec         Active sort specification.
   * @param cursor           Decoded keyset cursor (null = first page).
   * @param limit            Page size (already capped at 100 by service).
   */
  async findPage(
    tenantId: string,
    compiledFilter: CompiledPredicate | null,
    scopeSql: string | null,
    scopeParams: unknown[],
    sortSpec: QueueSortItem[],
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<QueuePage> {
    // ── Build parameter list and SQL fragments ────────────────────────────
    const params: unknown[] = [tenantId];  // $1 = tenantId

    // Embed filter predicate (rebase $N offsets)
    let filterFragment = '1=1';
    if (compiledFilter && compiledFilter.sql && compiledFilter.params.length > 0) {
      const offset = params.length;
      params.push(...compiledFilter.params);
      filterFragment = rebaseParams(compiledFilter.sql, offset);
    } else if (compiledFilter && compiledFilter.sql) {
      filterFragment = compiledFilter.sql;
    }

    // Embed scope predicate
    let scopeFragment = '1=1';
    if (scopeSql && scopeParams.length > 0) {
      const offset = params.length;
      params.push(...scopeParams);
      scopeFragment = rebaseParams(scopeSql, offset);
    } else if (scopeSql) {
      scopeFragment = scopeSql;
    }

    // Embed cursor predicate
    let cursorFragment = '1=1';
    if (cursor) {
      const { sql: cSql, params: cParams } = buildCursorPredicate(sortSpec, cursor);
      const offset = params.length;
      params.push(...cParams);
      cursorFragment = rebaseParams(cSql, offset);
    }

    // Embed limit
    const limitParam = limit + 1;  // fetch one extra to detect hasMore
    params.push(limitParam);
    const limitPlaceholder = `$${params.length}`;

    // ORDER BY
    const orderBy = buildOrderByClause(sortSpec);

    // ── Main query ────────────────────────────────────────────────────────
    const querySql = `
      SELECT
        t.id,
        t.ticket_number,
        t.subject,
        t.status,
        t.priority,
        t.ai_status,
        t.updated_at,
        t.created_at,
        t.resolved_at,
        t.assignee_id,
        t.organization_id,
        o.name AS organization_name,
        COALESCE(
          (
            SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color))
            FROM ticket_tags tt2
            JOIN tags tg ON tg.id = tt2.tag_id AND tg.tenant_id = tt2.tenant_id
            WHERE tt2.tenant_id = t.tenant_id
              AND tt2.ticket_id = t.id
            LIMIT 20
          ),
          '[]'::json
        ) AS tags
      FROM tickets t
      LEFT JOIN organizations o
        ON o.id = t.organization_id
        AND o.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1::uuid
        AND (${filterFragment})
        AND (${scopeFragment})
        AND (${cursorFragment})
      ORDER BY ${orderBy}
      LIMIT ${limitPlaceholder}
    `;

    const startMs = Date.now();
    const result = await this.tx.execute(sql.raw(querySql, params as never[]));
    const durationMs = Date.now() - startMs;
    this.logger.debug('Queue query executed', { durationMs, rows: result.rows?.length ?? 0 });

    const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];

    // Detect hasMore from the extra row
    const hasMore = rawRows.length > limit;
    const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;

    // Map raw rows to typed QueueRow
    const rows: QueueRow[] = pageRows.map((r) => mapRow(r));

    // ── Total estimate ─────────────────────────────────────────────────────
    const totalEstimate = await this.estimateCount(
      tenantId,
      filterFragment,
      scopeFragment,
      params.slice(0, -1),  // exclude the LIMIT param
    );

    return { rows, hasMore, totalEstimate };
  }

  // --------------------------------------------------------------------------
  // Count estimation with timeout fallback
  // --------------------------------------------------------------------------

  private async estimateCount(
    tenantId: string,
    filterFragment: string,
    scopeFragment: string,
    params: unknown[],
  ): Promise<TotalEstimate> {
    // Try exact COUNT with a short per-statement timeout
    try {
      await this.tx.execute(sql.raw(`SET LOCAL statement_timeout = '3s'`));
      const countSql = `
        SELECT COUNT(*)::bigint AS cnt
        FROM tickets t
        WHERE t.tenant_id = $1::uuid
          AND (${filterFragment})
          AND (${scopeFragment})
      `;
      const result = await this.tx.execute(sql.raw(countSql, params as never[]));
      const rows = (result as unknown as { rows: Array<{ cnt: string }> }).rows;
      const cnt = parseInt(rows[0]?.cnt ?? '0', 10);
      // Reset timeout for the rest of the transaction
      await this.tx.execute(sql.raw(`SET LOCAL statement_timeout = DEFAULT`));
      return { value: cnt, exact: true };
    } catch {
      // Timeout or error — fall back to approximate count from pg_class
      try {
        const approxResult = await this.tx.execute(sql.raw(
          `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'tickets'`,
        ));
        const approxRows = (approxResult as unknown as { rows: Array<{ estimate: string }> }).rows;
        const estimate = parseInt(approxRows[0]?.estimate ?? '0', 10);
        return { value: Math.max(estimate, 0), exact: false };
      } catch {
        return { value: 0, exact: false };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rebase $N positional placeholders in a SQL fragment by adding `offset`
 * to each placeholder number. e.g. $1 with offset=3 becomes $4.
 */
function rebaseParams(sqlFragment: string, offset: number): string {
  return sqlFragment.replace(/\$(\d+)/g, (_, n: string) => `$${parseInt(n, 10) + offset}`);
}

function mapRow(r: Record<string, unknown>): QueueRow {
  let tags: Array<{ id: string; name: string; color: string | null }> = [];
  try {
    const raw = r['tags'];
    if (typeof raw === 'string') tags = JSON.parse(raw);
    else if (Array.isArray(raw)) tags = raw as typeof tags;
  } catch {
    tags = [];
  }

  return {
    id: r['id'] as string,
    ticket_number: r['ticket_number'] != null ? Number(r['ticket_number']) : null,
    subject: r['subject'] as string,
    status: r['status'] as string,
    priority: r['priority'] as string,
    ai_status: (r['ai_status'] as string | null) ?? null,
    updated_at: r['updated_at'] instanceof Date
      ? (r['updated_at'] as Date).toISOString()
      : (r['updated_at'] as string),
    created_at: r['created_at'] instanceof Date
      ? (r['created_at'] as Date).toISOString()
      : (r['created_at'] as string),
    resolved_at: r['resolved_at'] != null
      ? (r['resolved_at'] instanceof Date
        ? (r['resolved_at'] as Date).toISOString()
        : (r['resolved_at'] as string))
      : null,
    organization: r['organization_id']
      ? { id: r['organization_id'] as string, name: (r['organization_name'] as string) ?? '' }
      : null,
    assignee: r['assignee_id'] ? { id: r['assignee_id'] as string } : null,
    tags,
    category: null,
    sla: null,
    has_jira_link: false,
  };
}
