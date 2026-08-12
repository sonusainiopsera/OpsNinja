/**
 * JiraReconciliationRepository — read access for jira_reconciliation_runs (WO-057).
 *
 * Write operations (INSERT, UPDATE) are performed directly by the reconciliation
 * worker via its own pool connection (not via Drizzle/TenantRepository) so that
 * the worker can operate outside the HTTP request cycle. This repository is
 * read-only for the API layer.
 */

import { Injectable } from '@nestjs/common';
import { desc, eq, and, sql } from 'drizzle-orm';
import {
  jiraReconciliationRuns,
  type JiraReconciliationRun,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';

export interface ReconciliationRunPage {
  data: JiraReconciliationRun[];
  nextCursor: string | null;
}

@Injectable()
export class JiraReconciliationRepository extends TenantRepository {

  /**
   * List reconciliation runs for a connection, cursor-paginated descending
   * by createdAt.
   */
  async listRuns(
    tenantId: string,
    connectionId: string,
    limit: number,
    cursor?: string,
  ): Promise<ReconciliationRunPage> {
    const conditions = [
      eq(jiraReconciliationRuns.tenantId, tenantId),
      eq(jiraReconciliationRuns.connectionId, connectionId),
    ];

    if (cursor) {
      // Cursor is base64(JSON { createdAt: ISO, id: uuid })
      const { createdAt: cursorCreatedAt, id: cursorId } = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf8'),
      ) as { createdAt: string; id: string };

      conditions.push(
        sql`(${jiraReconciliationRuns.createdAt} < ${new Date(cursorCreatedAt)} OR (${jiraReconciliationRuns.createdAt} = ${new Date(cursorCreatedAt)} AND ${jiraReconciliationRuns.id} < ${cursorId}))`,
      );
    }

    const rows = await this.tx
      .select()
      .from(jiraReconciliationRuns)
      .where(and(...conditions))
      .orderBy(desc(jiraReconciliationRuns.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            createdAt: page[page.length - 1]!.createdAt.toISOString(),
            id: page[page.length - 1]!.id,
          }),
        ).toString('base64')
      : null;

    return { data: page, nextCursor };
  }

  /** Return the most-recent active (outcome='running') run for a connection. */
  async findActiveRun(
    tenantId: string,
    connectionId: string,
  ): Promise<JiraReconciliationRun | null> {
    const rows = await this.tx
      .select()
      .from(jiraReconciliationRuns)
      .where(
        and(
          eq(jiraReconciliationRuns.tenantId, tenantId),
          eq(jiraReconciliationRuns.connectionId, connectionId),
          eq(jiraReconciliationRuns.outcome, 'running'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
