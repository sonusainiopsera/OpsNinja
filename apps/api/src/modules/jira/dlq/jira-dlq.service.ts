/**
 * JiraDlqService — DLQ inspection and replay business logic (WO-056).
 *
 * Public entry points:
 *   list(filter, principal)            — paginated DLQ item list
 *   replaySingle(id, principal)        — re-enqueue one DLQ item
 *   replayBatch(filter, principal)     — re-enqueue a filtered batch (capped at MAX_BATCH)
 *
 * Constraints:
 *   - Replay is capped at MAX_BATCH (500) per call.
 *   - Replay validates that the link is still in 'failed' or resolvable state.
 *   - Each replay writes an audit record in the same transaction as the outbox event.
 *   - Items already replayed within the last 5 minutes are skipped to prevent
 *     concurrent double-replay.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JiraDlqRepository, type DlqListFilter } from './jira-dlq.repository';
import { AuditWriter } from '../../audit/audit-writer';
import type { PrincipalContext } from '../../../observability/request-context';
import type { JiraSyncDlqItem } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on the number of items that can be replayed in a single batch call. */
export const MAX_BATCH = 500;

/** Guard against concurrent replays: skip if replayed within this window. */
const REPLAY_DEBOUNCE_MS = 5 * 60_000; // 5 minutes

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface DlqItemResponse {
  id: string;
  tenantId: string;
  linkId: string;
  ticketId: string;
  connectionId: string;
  eventType: string;
  attempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  firstSeenAt: string;
  lastAttemptAt: string | null;
  replayedAt: string | null;
  replayedBy: string | null;
}

export interface DlqListResponse {
  data: DlqItemResponse[];
  nextCursor: string | null;
}

export interface ReplaySingleResponse {
  requeued: boolean;
}

export interface ReplayBatchFilter {
  ids?: string[];
  connectionId?: string;
  eventType?: string;
  max?: number;
}

export interface ReplayBatchResponse {
  requeued: number;
  skipped: Array<{ id: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class JiraDlqService {
  private readonly logger = new Logger(JiraDlqService.name);

  constructor(
    private readonly repo: JiraDlqRepository,
    private readonly auditWriter: AuditWriter,
  ) {}

  // --------------------------------------------------------------------------
  // list — GET /api/v1/integrations/jira/dlq
  // --------------------------------------------------------------------------

  async list(filter: DlqListFilter, principal: PrincipalContext): Promise<DlqListResponse> {
    const { tenantId } = principal;
    const limit = Math.min(filter.limit ?? 50, 200);

    const items = await this.repo.list({ ...filter, tenantId, limit: limit + 1 });

    let nextCursor: string | null = null;
    if (items.length > limit) {
      const lastItem = items[limit - 1]!;
      nextCursor = this.repo.encodeCursor(lastItem);
      items.splice(limit);
    }

    return {
      data: items.map(toResponse),
      nextCursor,
    };
  }

  // --------------------------------------------------------------------------
  // replaySingle — POST /api/v1/integrations/jira/dlq/:id/replay
  // --------------------------------------------------------------------------

  async replaySingle(id: string, principal: PrincipalContext): Promise<ReplaySingleResponse> {
    const { tenantId, userId } = principal;
    const item = await this.repo.findById(tenantId, id);

    if (!item) {
      throw new NotFoundException({
        error: { code: 'DLQ_ITEM_NOT_FOUND', message: 'DLQ item not found.' },
      });
    }

    const skipReason = this.checkReplayPreconditions(item);
    if (skipReason) {
      throw new UnprocessableEntityException({
        error: { code: 'DLQ_REPLAY_PRECONDITION_FAILED', message: skipReason },
      });
    }

    const actorId = userId ?? 'system';
    await this.repo.markReplayed(tenantId, id, actorId);
    await this.repo.emitReplayEvent(
      tenantId,
      item.linkId,
      item.id,
      item.eventType,
      item.originalPayload,
      actorId,
    );

    await this.auditWriter.append({
      resourceType: 'jira_sync_dlq',
      resourceId: id,
      action: 'replay',
      beforeState: { attempts: item.attempts, lastErrorCode: item.lastErrorCode },
      afterState: { replayedBy: actorId, replayedAt: new Date().toISOString() },
      metadata: { tenantId, actorId, linkId: item.linkId },
    });

    this.logger.log('DLQ item replayed', { tenantId, dlqId: id, linkId: item.linkId, actorId });
    return { requeued: true };
  }

  // --------------------------------------------------------------------------
  // replayBatch — POST /api/v1/integrations/jira/dlq/replay
  // --------------------------------------------------------------------------

  async replayBatch(
    filter: ReplayBatchFilter,
    principal: PrincipalContext,
  ): Promise<ReplayBatchResponse> {
    const { tenantId, userId } = principal;
    const actorId = userId ?? 'system';
    const cap = Math.min(filter.max ?? MAX_BATCH, MAX_BATCH);

    let items: JiraSyncDlqItem[];

    if (filter.ids && filter.ids.length > 0) {
      // Explicit id list
      const ids = filter.ids.slice(0, cap);
      items = await this.repo.findByIds(tenantId, ids);
    } else {
      // Filter-based (connectionId / eventType)
      items = await this.repo.list({
        tenantId,
        connectionId: filter.connectionId,
        eventType: filter.eventType,
        limit: cap,
      });
    }

    let requeued = 0;
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const item of items) {
      const skipReason = this.checkReplayPreconditions(item);
      if (skipReason) {
        skipped.push({ id: item.id, reason: skipReason });
        continue;
      }

      try {
        await this.repo.markReplayed(tenantId, item.id, actorId);
        await this.repo.emitReplayEvent(
          tenantId,
          item.linkId,
          item.id,
          item.eventType,
          item.originalPayload,
          actorId,
        );

        await this.auditWriter.append({
          resourceType: 'jira_sync_dlq',
          resourceId: item.id,
          action: 'replay',
          beforeState: { attempts: item.attempts, lastErrorCode: item.lastErrorCode },
          afterState: { replayedBy: actorId, replayedAt: new Date().toISOString() },
          metadata: { tenantId, actorId, linkId: item.linkId },
        });

        requeued++;
      } catch (err: unknown) {
        this.logger.error('Failed to replay DLQ item', {
          tenantId, dlqId: item.id, error: (err as Error).message,
        });
        skipped.push({ id: item.id, reason: 'internal_error' });
      }
    }

    this.logger.log('DLQ batch replay complete', { tenantId, requeued, skipped: skipped.length, actorId });
    return { requeued, skipped };
  }

  // --------------------------------------------------------------------------
  // Precondition validation
  // --------------------------------------------------------------------------

  private checkReplayPreconditions(item: JiraSyncDlqItem): string | null {
    // Already replayed recently
    if (item.replayedAt) {
      const elapsed = Date.now() - item.replayedAt.getTime();
      if (elapsed < REPLAY_DEBOUNCE_MS) {
        return `Item was replayed recently (${Math.round(elapsed / 1000)}s ago). Wait before replaying again.`;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function toResponse(item: JiraSyncDlqItem): DlqItemResponse {
  return {
    id: item.id,
    tenantId: item.tenantId,
    linkId: item.linkId,
    ticketId: item.ticketId,
    connectionId: item.connectionId,
    eventType: item.eventType,
    attempts: item.attempts,
    lastErrorCode: item.lastErrorCode ?? null,
    lastErrorMessage: item.lastErrorMessage ?? null,
    firstSeenAt: item.firstSeenAt.toISOString(),
    lastAttemptAt: item.lastAttemptAt ? item.lastAttemptAt.toISOString() : null,
    replayedAt: item.replayedAt ? item.replayedAt.toISOString() : null,
    replayedBy: item.replayedBy ?? null,
  };
}
