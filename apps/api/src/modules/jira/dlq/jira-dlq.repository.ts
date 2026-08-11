/**
 * JiraDlqRepository — data access for jira_sync_dlq (WO-056).
 *
 * Extends TenantRepository so all queries run inside the RLS-bound tenant
 * transaction set up by TenantContextInterceptor.
 *
 * All reads and writes are tenant-scoped.  Cursor pagination uses the
 * (first_seen_at, id) tuple so results are stable when new items arrive.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, lt, lte, sql, inArray } from 'drizzle-orm';
import {
  jiraSyncDlq,
  outboxEvents,
  type JiraSyncDlqItem,
  type NewJiraSyncDlqItem,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';

// ---------------------------------------------------------------------------
// Filter / cursor types
// ---------------------------------------------------------------------------

export interface DlqListFilter {
  tenantId: string;
  connectionId?: string;
  eventType?: string;
  /** Base64-encoded cursor from previous page. */
  cursor?: string;
  limit: number;
}

export interface DlqCursor {
  firstSeenAt: string; // ISO 8601
  id: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class JiraDlqRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<JiraSyncDlqItem | null> {
    const rows = await this.tx
      .select()
      .from(jiraSyncDlq)
      .where(and(
        eq(jiraSyncDlq.tenantId, tenantId),
        eq(jiraSyncDlq.id, id),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(filter: DlqListFilter): Promise<JiraSyncDlqItem[]> {
    const { tenantId, connectionId, eventType, cursor, limit } = filter;

    // Base condition: tenant scope
    const conditions = [eq(jiraSyncDlq.tenantId, tenantId)];

    if (connectionId) {
      conditions.push(eq(jiraSyncDlq.connectionId, connectionId));
    }
    if (eventType) {
      conditions.push(eq(jiraSyncDlq.eventType, eventType));
    }

    // Cursor: (first_seen_at <= cursorFirstSeenAt) AND (id < cursorId when timestamps equal)
    if (cursor) {
      const decoded = this.decodeCursor(cursor);
      if (decoded) {
        conditions.push(
          sql`(${jiraSyncDlq.firstSeenAt}, ${jiraSyncDlq.id}) < (${decoded.firstSeenAt}::timestamptz, ${decoded.id}::uuid)`,
        );
      }
    }

    return this.tx
      .select()
      .from(jiraSyncDlq)
      .where(and(...conditions))
      .orderBy(sql`${jiraSyncDlq.firstSeenAt} DESC, ${jiraSyncDlq.id} DESC`)
      .limit(limit);
  }

  async findByIds(tenantId: string, ids: string[]): Promise<JiraSyncDlqItem[]> {
    if (ids.length === 0) return [];
    return this.tx
      .select()
      .from(jiraSyncDlq)
      .where(and(
        eq(jiraSyncDlq.tenantId, tenantId),
        inArray(jiraSyncDlq.id, ids),
      ));
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  async markReplayed(tenantId: string, id: string, replayedBy: string): Promise<JiraSyncDlqItem | null> {
    const rows = await this.tx
      .update(jiraSyncDlq)
      .set({ replayedAt: new Date(), replayedBy })
      .where(and(
        eq(jiraSyncDlq.tenantId, tenantId),
        eq(jiraSyncDlq.id, id),
      ))
      .returning();
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Outbox (same transaction)
  // --------------------------------------------------------------------------

  /** Emit a jira.link.retry outbox event for replayed DLQ items. */
  async emitReplayEvent(
    tenantId: string,
    linkId: string,
    dlqId: string,
    eventType: string,
    originalPayload: unknown,
    replayedBy: string,
  ): Promise<void> {
    await this.tx
      .insert(outboxEvents)
      .values({
        tenantId,
        aggregateType: 'jira_link',
        aggregateId: linkId,
        eventType: 'jira.link.retry',
        payload: {
          dlqId,
          originalEventType: eventType,
          originalPayload,
          replayedBy,
        },
        status: 'pending',
      });
  }

  // --------------------------------------------------------------------------
  // Cursor helpers
  // --------------------------------------------------------------------------

  encodeCursor(item: JiraSyncDlqItem): string {
    const cursor: DlqCursor = {
      firstSeenAt: item.firstSeenAt.toISOString(),
      id: item.id,
    };
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decodeCursor(encoded: string): DlqCursor | null {
    try {
      const raw = Buffer.from(encoded, 'base64url').toString('utf8');
      return JSON.parse(raw) as DlqCursor;
    } catch {
      return null;
    }
  }
}
