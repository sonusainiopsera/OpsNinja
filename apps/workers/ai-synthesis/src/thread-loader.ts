/**
 * ThreadLoader — assembles the full ticket context for LLM synthesis.
 *
 * Loads from the DB directly (worker process, not the API process) using raw
 * pg with SET LOCAL app.current_tenant already applied by the caller.
 *
 * Output normalisation:
 *   - Comments ordered chronologically (created_at ASC).
 *   - Internal notes included for synthesis; visibility label preserved.
 *   - Attachments referenced by filename only — never fetched.
 *   - Thread truncated deterministically when token-estimate exceeds MAX_CHARS.
 *
 * AC-3: subject, description, ordered comments with author role + visibility,
 *       category path, priority, organisation name.
 * AC-3 constraint: attachments by filename only.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, asc } from 'drizzle-orm';
import {
  tickets,
  ticketComments,
  organizations,
  type Ticket,
  type TicketComment,
} from '@opsninja/db';
import type { SynthesisRequest, ThreadMessage } from './llm-provider.port';

/** Approximate character limit before deterministic truncation. ~50k tokens. */
const MAX_CHARS = 200_000;

@Injectable()
export class ThreadLoader {
  private readonly logger = new Logger(ThreadLoader.name);

  constructor(private readonly pool: Pool) {}

  /**
   * Assemble a SynthesisRequest for the given ticket.
   * Must be called after SET LOCAL app.current_tenant has been issued on `client`.
   *
   * @throws Error when the ticket is not found (deleted/purged — caller should skip).
   */
  async load(
    client: PoolClient,
    tenantId: string,
    ticketId: string,
  ): Promise<SynthesisRequest> {
    const db = drizzle(client as never, {
      schema: { tickets, ticketComments, organizations },
    });

    // ── Ticket row ────────────────────────────────────────────────────────
    const ticketRows = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.tenantId, tenantId), eq(tickets.id, ticketId)))
      .limit(1);

    const ticket = ticketRows[0];
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found for tenant ${tenantId}`);
    }

    // ── Organization name ─────────────────────────────────────────────────
    const orgRows = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(
        and(
          eq(organizations.tenantId, tenantId),
          eq(organizations.id, ticket.organizationId),
        ),
      )
      .limit(1);
    const organizationName = orgRows[0]?.name ?? 'Unknown';

    // ── Comments ──────────────────────────────────────────────────────────
    const comments = await db
      .select()
      .from(ticketComments)
      .where(and(eq(ticketComments.tenantId, tenantId), eq(ticketComments.ticketId, ticketId)))
      .orderBy(asc(ticketComments.createdAt));

    // ── Normalise messages ────────────────────────────────────────────────
    const messages: ThreadMessage[] = comments.map((c) => ({
      role: this.inferRole(c),
      visibility: (c.visibility ?? 'public') as 'public' | 'internal',
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    }));

    // ── Truncation ────────────────────────────────────────────────────────
    const { messages: truncatedMessages, truncated } = this.truncate(
      ticket,
      messages,
    );

    if (truncated) {
      this.logger.warn('Thread truncated before synthesis', {
        tenantId,
        ticketId,
        originalCount: messages.length,
        truncatedCount: truncatedMessages.length,
      });
    }

    return {
      ticketId,
      tenantId,
      subject: ticket.subject,
      description: ticket.description ?? null,
      priority: ticket.priority,
      categoryPath: null, // Category path stored separately; extend when available
      organizationName,
      messages: truncatedMessages,
      truncated,
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private inferRole(comment: TicketComment): 'agent' | 'portal_user' | 'system' {
    // isInternal / internal visibility → agent note
    if (comment.isInternal || comment.visibility === 'internal') return 'agent';
    // authorId null → system-generated
    if (!comment.authorId) return 'system';
    // Default to agent for non-portal comments (portal contacts have a contactId path)
    return 'agent';
  }

  private truncate(
    ticket: Ticket,
    messages: ThreadMessage[],
  ): { messages: ThreadMessage[]; truncated: boolean } {
    const header = `${ticket.subject}\n${ticket.description ?? ''}`;
    let total = header.length;
    const kept: ThreadMessage[] = [];

    for (const msg of messages) {
      if (total + msg.body.length > MAX_CHARS) {
        return { messages: kept, truncated: true };
      }
      total += msg.body.length;
      kept.push(msg);
    }

    return { messages: kept, truncated: false };
  }
}
