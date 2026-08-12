/**
 * JiraReconciliationService — orchestrates manual reconcile trigger and
 * run-history reads for the API layer (WO-057 AC2, AC7).
 *
 * Manual trigger: publishes a jira-reconciliation SQS message so the worker
 * picks it up asynchronously (202 Accepted). The API layer never runs the
 * reconciliation logic directly.
 *
 * Concurrency guard: checks for a currently-running run (outcome='running')
 * before accepting the trigger; returns 429 if one is active.
 */

import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Inject } from '@nestjs/common';
import { JiraReconciliationRepository } from './jira-reconciliation.repository';
import { RECON_LOOKBACK_MAX_HOURS } from '@opsninja/db';
import { randomUUID } from 'crypto';

export const SQS_CLIENT = 'SQS_CLIENT';
export const JIRA_SYNC_QUEUE_URL = 'JIRA_SYNC_QUEUE_URL';

export interface TriggerReconcileResult {
  runId: string;
  message: string;
}

export interface ReconcileRunsResponse {
  data: Array<{
    id: string;
    connectionId: string;
    windowStart: string;
    windowEnd: string;
    issuesScanned: number;
    driftDetected: number;
    eventsSynthesised: number;
    pendingRepaired: number;
    orphansFound: number;
    durationMs: number | null;
    outcome: string;
    error: string | null;
  }>;
  nextCursor: string | null;
}

@Injectable()
export class JiraReconciliationService {
  private readonly logger = new Logger(JiraReconciliationService.name);

  constructor(
    private readonly repo: JiraReconciliationRepository,
    @Inject(SQS_CLIENT) private readonly sqsClient: SQSClient,
    @Inject(JIRA_SYNC_QUEUE_URL) private readonly queueUrl: string,
  ) {}

  /**
   * Trigger a manual reconciliation run for a connection.
   * Returns 409 if a run is already active for this connection.
   */
  async triggerReconcile(
    tenantId: string,
    connectionId: string,
    lookbackHours: number,
  ): Promise<TriggerReconcileResult> {
    const clampedHours = Math.min(
      Math.max(1, lookbackHours),
      RECON_LOOKBACK_MAX_HOURS,
    );

    // Check for concurrent active run
    const activeRun = await this.repo.findActiveRun(tenantId, connectionId);
    if (activeRun) {
      throw new ConflictException({
        error: {
          code: 'RECONCILIATION_ALREADY_ACTIVE',
          message: 'A reconciliation run is already active for this connection.',
          details: [{ runId: activeRun.id }],
        },
      });
    }

    const manualRunId = randomUUID();

    const message = {
      source: 'jira-reconciliation' as const,
      tenantId,
      connectionId,
      lookbackHours: clampedHours,
      manualRunId,
    };

    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: `recon:${connectionId}`,
        MessageDeduplicationId: `recon:${connectionId}:${manualRunId}`,
      }),
    );

    this.logger.log('Manual reconciliation triggered', {
      tenantId,
      connectionId,
      lookbackHours: clampedHours,
      manualRunId,
    });

    return {
      runId: manualRunId,
      message: 'Reconciliation run enqueued.',
    };
  }

  /**
   * List reconciliation run history for a connection.
   */
  async listRuns(
    tenantId: string,
    connectionId: string,
    limit: number,
    cursor?: string,
  ): Promise<ReconcileRunsResponse> {
    const { data, nextCursor } = await this.repo.listRuns(
      tenantId,
      connectionId,
      limit,
      cursor,
    );

    return {
      data: data.map((r) => ({
        id: r.id,
        connectionId: r.connectionId,
        windowStart: r.windowStart.toISOString(),
        windowEnd: r.windowEnd.toISOString(),
        issuesScanned: r.issuesScanned,
        driftDetected: r.driftDetected,
        eventsSynthesised: r.eventsSynthesised,
        pendingRepaired: r.pendingRepaired,
        orphansFound: r.orphansFound,
        durationMs: r.durationMs,
        outcome: r.outcome,
        error: r.error,
      })),
      nextCursor,
    };
  }
}
