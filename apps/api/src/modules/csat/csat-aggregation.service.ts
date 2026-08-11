/**
 * CsatAggregationService – aggregation queries for the CSAT KPI dashboard.
 *
 * All queries run on the read replica via TenantScopedReplicaRunner with a
 * 30-second statement timeout.  Zero-state (no responses) returns structured
 * zeros rather than errors.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql, and, eq, gte, lte, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { csatSurveys } from '@opsninja/db';
import { TenantScopedReplicaRunner } from '../reporting/infrastructure/tenant-scoped-replica.runner';

export interface CsatAggregationResult {
  averageScore: number | null;
  responseCount: number;
  sentCount: number;
  responseRate: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

@Injectable()
export class CsatAggregationService {
  private readonly logger = new Logger(CsatAggregationService.name);

  constructor(private readonly replicaRunner: TenantScopedReplicaRunner) {}

  async getSummary(
    tenantId: string,
    from: Date,
    to: Date,
    organizationId?: string,
  ): Promise<CsatAggregationResult> {
    return this.replicaRunner.run(async (tx: NodePgDatabase) => {
      const conditions = [
        eq(csatSurveys.tenantId, tenantId),
        gte(csatSurveys.sentAt, from),
        lte(csatSurveys.sentAt, to),
      ];

      // sentCount: all delivered surveys in window
      const sentResult = await tx
        .select({ count: sql<string>`count(*)::text` })
        .from(csatSurveys)
        .where(
          and(
            ...conditions,
            ...(organizationId ? [this.filterByOrg(organizationId)] : []),
          ),
        );

      const sentCount = parseInt(sentResult[0]?.count ?? '0', 10);

      // responseCount and distribution: only responded rows
      const responseResult = await tx
        .select({
          count: sql<string>`count(*)::text`,
          avgScore: sql<string>`avg(score)::text`,
          d1: sql<string>`count(*) filter (where score = 1)::text`,
          d2: sql<string>`count(*) filter (where score = 2)::text`,
          d3: sql<string>`count(*) filter (where score = 3)::text`,
          d4: sql<string>`count(*) filter (where score = 4)::text`,
          d5: sql<string>`count(*) filter (where score = 5)::text`,
        })
        .from(csatSurveys)
        .where(
          and(
            ...conditions,
            isNotNull(csatSurveys.respondedAt),
            ...(organizationId ? [this.filterByOrg(organizationId)] : []),
          ),
        );

      const row = responseResult[0];
      const responseCount = parseInt(row?.count ?? '0', 10);
      const averageScore = row?.avgScore ? parseFloat(row.avgScore) : null;
      const responseRate = sentCount > 0 ? responseCount / sentCount : 0;

      const distribution: CsatAggregationResult['distribution'] = {
        '1': parseInt(row?.d1 ?? '0', 10),
        '2': parseInt(row?.d2 ?? '0', 10),
        '3': parseInt(row?.d3 ?? '0', 10),
        '4': parseInt(row?.d4 ?? '0', 10),
        '5': parseInt(row?.d5 ?? '0', 10),
      };

      this.logger.debug('CSAT aggregation complete', {
        tenantId,
        from: from.toISOString(),
        to: to.toISOString(),
        sentCount,
        responseCount,
      });

      return { averageScore, responseCount, sentCount, responseRate, distribution };
    });
  }

  // Contact-facing tickets don't carry org_id directly on csat_surveys;
  // use a sub-select through tickets when org filtering is required.
  private filterByOrg(organizationId: string) {
    return sql`${csatSurveys.ticketId} IN (
      SELECT id FROM tickets
      WHERE tenant_id = current_setting('app.current_tenant', true)::uuid
        AND organization_id = ${organizationId}
    )`;
  }
}
