/**
 * CsatAggregationService
 *
 * Computes CSAT summary statistics for a tenant over a date range.
 * Runs against the read replica to keep leadership dashboard queries off
 * the primary write path.
 *
 * Returns zero-state values (not errors) when no surveys exist:
 *   { averageScore: null, responseCount: 0, sentCount: 0, responseRate: 0,
 *     distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } }
 *
 * Statement timeout is set to 30 seconds inside the replica runner.
 */

import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

import { TenantScopedReplicaRunner } from '../reporting/infrastructure/tenant-scoped-replica.runner';
import type { CsatSummary } from '@opsninja/db';

const REPLICA_STATEMENT_TIMEOUT_MS = 30_000;

@Injectable()
export class CsatAggregationService {
  constructor(private readonly replicaRunner: TenantScopedReplicaRunner) {}

  async getSummary(params: {
    from: Date;
    to: Date;
    organizationId?: string;
  }): Promise<CsatSummary> {
    return this.replicaRunner.run(async (client) => {
      await client.query(`SET LOCAL statement_timeout = ${REPLICA_STATEMENT_TIMEOUT_MS}`);
      return this.queryAggregates(client, params);
    });
  }

  private async queryAggregates(
    client: PoolClient,
    params: { from: Date; to: Date; organizationId?: string },
  ): Promise<CsatSummary> {
    const { from, to, organizationId } = params;

    // Aggregation over all surveys sent in the date range.
    const sentResult = await client.query<{ sent_count: string }>(
      `SELECT count(*) AS sent_count
       FROM csat_surveys
       WHERE sent_at >= $1
         AND sent_at <= $2
         ${organizationId ? 'AND ticket_id IN (SELECT id FROM tickets WHERE organization_id = $3)' : ''}`,
      organizationId ? [from, to, organizationId] : [from, to],
    );

    const sentCount = parseInt(sentResult.rows[0]?.sent_count ?? '0', 10);

    // Aggregation over responded surveys in the date range.
    const responseResult = await client.query<{
      response_count: string;
      avg_score: string | null;
      dist_1: string;
      dist_2: string;
      dist_3: string;
      dist_4: string;
      dist_5: string;
    }>(
      `SELECT
         count(*)                                        AS response_count,
         avg(score)::numeric(4,2)                       AS avg_score,
         count(*) FILTER (WHERE score = 1)              AS dist_1,
         count(*) FILTER (WHERE score = 2)              AS dist_2,
         count(*) FILTER (WHERE score = 3)              AS dist_3,
         count(*) FILTER (WHERE score = 4)              AS dist_4,
         count(*) FILTER (WHERE score = 5)              AS dist_5
       FROM csat_surveys
       WHERE responded_at IS NOT NULL
         AND sent_at >= $1
         AND sent_at <= $2
         ${organizationId ? 'AND ticket_id IN (SELECT id FROM tickets WHERE organization_id = $3)' : ''}`,
      organizationId ? [from, to, organizationId] : [from, to],
    );

    const row = responseResult.rows[0];
    const responseCount = parseInt(row?.response_count ?? '0', 10);
    const averageScore = row?.avg_score != null ? parseFloat(row.avg_score) : null;
    const responseRate = sentCount > 0 ? responseCount / sentCount : 0;

    return {
      averageScore,
      responseCount,
      sentCount,
      responseRate,
      distribution: {
        '1': parseInt(row?.dist_1 ?? '0', 10),
        '2': parseInt(row?.dist_2 ?? '0', 10),
        '3': parseInt(row?.dist_3 ?? '0', 10),
        '4': parseInt(row?.dist_4 ?? '0', 10),
        '5': parseInt(row?.dist_5 ?? '0', 10),
      },
    };
  }
}
