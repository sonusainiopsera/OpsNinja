/**
 * AI synthesis repository — thin Drizzle query layer for ticket_ai_summaries
 * and ticket_affected_areas.
 *
 * All operations are tenant-scoped: callers must supply tenant_id explicitly
 * so repository methods are composable inside a transaction where the
 * app.current_tenant session variable may not have been set yet.
 *
 * No raw SQL; all queries use parameterized Drizzle builder calls.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  ticketAiSummaries,
  ticketAffectedAreas,
  type NewTicketAiSummary,
  type NewTicketAffectedArea,
  type TicketAiSummary,
  type TicketAffectedArea,
} from '../schema/ai-synthesis.js';

export type AiSynthesisDb = PostgresJsDatabase;

const SUMMARY_TEXT_MAX_LENGTH = 8_000;

function capText(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value.length > SUMMARY_TEXT_MAX_LENGTH
    ? value.slice(0, SUMMARY_TEXT_MAX_LENGTH)
    : value;
}

// ---------------------------------------------------------------------------
// ticket_ai_summaries operations
// ---------------------------------------------------------------------------

/**
 * Upserts an AI summary row for a given (tenant_id, ticket_id) pair.
 * On conflict it overwrites the mutable fields but preserves attempt_count
 * unless the caller passes it explicitly. crux_summary and resolution_summary
 * are length-capped at SUMMARY_TEXT_MAX_LENGTH characters.
 */
export async function upsertSummaryByTicket(
  db: AiSynthesisDb,
  row: Omit<NewTicketAiSummary, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<TicketAiSummary> {
  const capped: NewTicketAiSummary = {
    ...row,
    cruxSummary: capText(row.cruxSummary),
    resolutionSummary: capText(row.resolutionSummary),
    updatedAt: new Date(),
  };

  const [result] = await db
    .insert(ticketAiSummaries)
    .values(capped)
    .onConflictDoUpdate({
      target: [ticketAiSummaries.tenantId, ticketAiSummaries.ticketId],
      set: {
        cruxSummary: capped.cruxSummary,
        resolutionSummary: capped.resolutionSummary,
        modelId: capped.modelId,
        promptVersion: capped.promptVersion,
        aiStatus: capped.aiStatus,
        lastErrorCode: capped.lastErrorCode ?? null,
        generatedAt: capped.generatedAt ?? null,
        updatedAt: capped.updatedAt,
      },
    })
    .returning();

  if (!result) throw new Error('upsertSummaryByTicket: no row returned');
  return result;
}

/**
 * Increments attempt_count by 1 and optionally sets ai_status and
 * last_error_code. Returns the updated row.
 */
export async function incrementAttempt(
  db: AiSynthesisDb,
  params: {
    tenantId: string;
    ticketId: string;
    aiStatus?: string;
    lastErrorCode?: string;
  },
): Promise<TicketAiSummary | undefined> {
  const rows = await db
    .select()
    .from(ticketAiSummaries)
    .where(
      and(
        eq(ticketAiSummaries.tenantId, params.tenantId),
        eq(ticketAiSummaries.ticketId, params.ticketId),
      ),
    )
    .limit(1);

  const existing = rows[0];
  if (!existing) return undefined;

  const [updated] = await db
    .update(ticketAiSummaries)
    .set({
      attemptCount: existing.attemptCount + 1,
      ...(params.aiStatus !== undefined ? { aiStatus: params.aiStatus } : {}),
      ...(params.lastErrorCode !== undefined
        ? { lastErrorCode: params.lastErrorCode }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ticketAiSummaries.tenantId, params.tenantId),
        eq(ticketAiSummaries.ticketId, params.ticketId),
      ),
    )
    .returning();

  return updated;
}

/**
 * Returns the AI summary row for a given (tenant_id, ticket_id), or undefined
 * if it does not exist.
 */
export async function findSummaryByTicket(
  db: AiSynthesisDb,
  tenantId: string,
  ticketId: string,
): Promise<TicketAiSummary | undefined> {
  const rows = await db
    .select()
    .from(ticketAiSummaries)
    .where(
      and(
        eq(ticketAiSummaries.tenantId, tenantId),
        eq(ticketAiSummaries.ticketId, ticketId),
      ),
    )
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// ticket_affected_areas operations
// ---------------------------------------------------------------------------

/**
 * Replaces all affected-area rows for a given (tenant_id, ticket_id) in a
 * single operation: deletes existing rows, then inserts the new set.
 * Duplicate area_label values in the input are de-duplicated before insert.
 * An empty areas array is a valid, non-error outcome (clears all tags).
 *
 * Callers must run this inside a transaction to ensure atomicity.
 */
export async function replaceAffectedAreas(
  db: AiSynthesisDb,
  tenantId: string,
  ticketId: string,
  areas: ReadonlyArray<Pick<NewTicketAffectedArea, 'areaLabel' | 'confidence' | 'source'>>,
): Promise<readonly TicketAffectedArea[]> {
  // Delete existing rows for this ticket.
  await db
    .delete(ticketAffectedAreas)
    .where(
      and(
        eq(ticketAffectedAreas.tenantId, tenantId),
        eq(ticketAffectedAreas.ticketId, ticketId),
      ),
    );

  if (areas.length === 0) return [];

  // De-duplicate by area_label (keep first occurrence).
  const seen = new Set<string>();
  const deduped: NewTicketAffectedArea[] = [];
  for (const area of areas) {
    if (!seen.has(area.areaLabel)) {
      seen.add(area.areaLabel);
      deduped.push({ tenantId, ticketId, ...area });
    }
  }

  const inserted = await db.insert(ticketAffectedAreas).values(deduped).returning();
  return inserted;
}

/**
 * Returns all affected-area rows for a given (tenant_id, ticket_id).
 */
export async function findAffectedAreasByTicket(
  db: AiSynthesisDb,
  tenantId: string,
  ticketId: string,
): Promise<readonly TicketAffectedArea[]> {
  return db
    .select()
    .from(ticketAffectedAreas)
    .where(
      and(
        eq(ticketAffectedAreas.tenantId, tenantId),
        eq(ticketAffectedAreas.ticketId, ticketId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Compliance: GDPR erasure helpers
// ---------------------------------------------------------------------------

/**
 * Enumerates all AI summary IDs for a set of ticket IDs within a tenant.
 * Used by the DataSubjectErasure orchestrator to build its erasure manifest.
 */
export async function enumerateSummaryIdsForTickets(
  db: AiSynthesisDb,
  tenantId: string,
  ticketIds: readonly string[],
): Promise<readonly string[]> {
  if (ticketIds.length === 0) return [];
  const rows = await db
    .select({ id: ticketAiSummaries.id })
    .from(ticketAiSummaries)
    .where(
      and(
        eq(ticketAiSummaries.tenantId, tenantId),
        inArray(ticketAiSummaries.ticketId, [...ticketIds]),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Enumerates all affected-area IDs for a set of ticket IDs within a tenant.
 */
export async function enumerateAffectedAreaIdsForTickets(
  db: AiSynthesisDb,
  tenantId: string,
  ticketIds: readonly string[],
): Promise<readonly string[]> {
  if (ticketIds.length === 0) return [];
  const rows = await db
    .select({ id: ticketAffectedAreas.id })
    .from(ticketAffectedAreas)
    .where(
      and(
        eq(ticketAffectedAreas.tenantId, tenantId),
        inArray(ticketAffectedAreas.ticketId, [...ticketIds]),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Physically deletes all AI summary and affected-area rows for the given
 * ticket IDs. Called by the DataSubjectErasure orchestrator and the
 * retention purge job.
 */
export async function deleteAiDataForTickets(
  db: AiSynthesisDb,
  tenantId: string,
  ticketIds: readonly string[],
): Promise<{ summariesDeleted: number; areasDeleted: number }> {
  if (ticketIds.length === 0) return { summariesDeleted: 0, areasDeleted: 0 };

  const ticketIdArr = [...ticketIds];

  const summariesResult = await db
    .delete(ticketAiSummaries)
    .where(
      and(
        eq(ticketAiSummaries.tenantId, tenantId),
        inArray(ticketAiSummaries.ticketId, ticketIdArr),
      ),
    )
    .returning({ id: ticketAiSummaries.id });

  const areasResult = await db
    .delete(ticketAffectedAreas)
    .where(
      and(
        eq(ticketAffectedAreas.tenantId, tenantId),
        inArray(ticketAffectedAreas.ticketId, ticketIdArr),
      ),
    )
    .returning({ id: ticketAffectedAreas.id });

  return {
    summariesDeleted: summariesResult.length,
    areasDeleted: areasResult.length,
  };
}
