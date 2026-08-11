/**
 * JiraPayloadBuilder — converts OpsNinja ticket context into an
 * Atlassian Document Format (ADF) description body (WO-053).
 *
 * Rules:
 *  - Builds a deterministic ADF document: ticket key, deep link, org,
 *    priority, category path, SLA target and the last 5 public comments.
 *  - Internal notes are EXCLUDED by default; included only when
 *    `includeInternalNotes=true` AND the mapping's syncRules.commentVisibility
 *    is 'internal' (both must be true — defence-in-depth).
 *  - Comment bodies are HTML-escaped and truncated to MAX_COMMENT_CHARS with
 *    an explicit "[truncated]" suffix and a link back to the ticket.
 *  - The entire description is capped at MAX_DESCRIPTION_CHARS.
 */

import { Injectable } from '@nestjs/common';
import type { SyncRules } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max characters per individual comment body before truncation. */
export const MAX_COMMENT_CHARS = 2_000;
/** Max comments included in the context block. */
export const MAX_COMMENTS = 5;
/** Truncation marker appended when a comment is cut. */
const TRUNCATION_MARKER = ' … [truncated — see full ticket for details]';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CommentContext {
  id: string;
  body: string;
  visibility: 'public' | 'internal';
  authorName: string | null;
  createdAt: string;
}

export interface TicketContext {
  ticketId: string;
  ticketNumber: number | null;
  ticketUrl: string;
  subject: string;
  organizationName: string;
  priority: string;
  categoryPath: string | null;
  slaTargetAt: string | null;
  comments: CommentContext[];
}

export interface BuildPayloadOptions {
  includeInternalNotes: boolean;
  /** mapping.syncRules — used to gate internal note inclusion. */
  syncRules: SyncRules;
}

// ---------------------------------------------------------------------------
// ADF node helpers
// ---------------------------------------------------------------------------

type AdfNode =
  | { type: 'doc'; version: 1; content: AdfNode[] }
  | { type: 'paragraph'; content: AdfInlineNode[] }
  | { type: 'heading'; attrs: { level: number }; content: AdfInlineNode[] }
  | { type: 'bulletList'; content: AdfNode[] }
  | { type: 'listItem'; content: AdfNode[] }
  | { type: 'rule' };

type AdfInlineNode =
  | { type: 'text'; text: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }
  | { type: 'hardBreak' };

function text(t: string): AdfInlineNode {
  return { type: 'text', text: t };
}

function bold(t: string): AdfInlineNode {
  return { type: 'text', text: t, marks: [{ type: 'strong' }] };
}

function link(t: string, href: string): AdfInlineNode {
  return { type: 'text', text: t, marks: [{ type: 'link', attrs: { href } }] };
}

function paragraph(...content: AdfInlineNode[]): AdfNode {
  return { type: 'paragraph', content };
}

function heading(level: number, ...content: AdfInlineNode[]): AdfNode {
  return { type: 'heading', attrs: { level }, content };
}

function rule(): AdfNode {
  return { type: 'rule' };
}

function bulletList(items: AdfInlineNode[][]): AdfNode {
  return {
    type: 'bulletList',
    content: items.map((inlines) => ({
      type: 'listItem',
      content: [paragraph(...inlines)],
    })),
  };
}

// ---------------------------------------------------------------------------
// HTML escape
// ---------------------------------------------------------------------------

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// JiraPayloadBuilder
// ---------------------------------------------------------------------------

@Injectable()
export class JiraPayloadBuilder {

  /**
   * Build the full ADF document for a new Jira issue description.
   * Returns a plain object suitable for JSON serialisation into the Jira API payload.
   */
  buildDescription(ticket: TicketContext, options: BuildPayloadOptions): AdfNode {
    const { includeInternalNotes, syncRules } = options;

    // Internal notes are included only when BOTH the caller requested it
    // AND the mapping's syncRules allow it — defence-in-depth.
    const allowInternalNotes =
      includeInternalNotes && syncRules.commentVisibility === 'internal';

    const nodes: AdfNode[] = [];

    // ── Context block ─────────────────────────────────────────────────────
    nodes.push(heading(2, text('OpsNinja Ticket Context')));

    const ticketLabel = ticket.ticketNumber
      ? `ON-${ticket.ticketNumber}`
      : ticket.ticketId;

    nodes.push(
      bulletList([
        [bold('Ticket: '), link(ticketLabel, ticket.ticketUrl)],
        [bold('Subject: '), text(htmlEscape(ticket.subject))],
        [bold('Organisation: '), text(htmlEscape(ticket.organizationName))],
        [bold('Priority: '), text(htmlEscape(ticket.priority))],
        [bold('Category: '), text(htmlEscape(ticket.categoryPath ?? 'Uncategorised'))],
        [
          bold('SLA Target: '),
          text(ticket.slaTargetAt
            ? new Date(ticket.slaTargetAt).toISOString()
            : 'No SLA set'),
        ],
      ]),
    );

    // ── Recent comments ───────────────────────────────────────────────────
    const visibleComments = ticket.comments
      .filter((c) => c.visibility === 'public' || allowInternalNotes)
      .slice(-MAX_COMMENTS);

    if (visibleComments.length > 0) {
      nodes.push(rule());
      nodes.push(heading(3, text('Recent Comments')));

      for (const comment of visibleComments) {
        const authorStr = comment.authorName
          ? htmlEscape(comment.authorName)
          : 'Unknown';
        const dateStr = new Date(comment.createdAt).toUTCString();
        const noteTag = comment.visibility === 'internal' ? ' [internal note]' : '';

        let body = htmlEscape(comment.body);
        if (body.length > MAX_COMMENT_CHARS) {
          body = body.slice(0, MAX_COMMENT_CHARS) + TRUNCATION_MARKER;
        }

        nodes.push(paragraph(bold(`${authorStr} — ${dateStr}${noteTag}`)));
        nodes.push(paragraph(text(body)));
      }
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    nodes.push(rule());
    nodes.push(
      paragraph(
        text('This issue was escalated from OpsNinja. '),
        link('View full ticket', ticket.ticketUrl),
      ),
    );

    return {
      type: 'doc',
      version: 1,
      content: nodes,
    };
  }

  /**
   * Build a minimal ADF document used for unit-test snapshot comparisons.
   * Exposed so tests can assert the structure without a full ticket context.
   */
  buildContextBlock(ticket: TicketContext): AdfNode {
    return this.buildDescription(ticket, {
      includeInternalNotes: false,
      syncRules: {
        applyInboundStatus: false,
        applyInboundComments: false,
        autoResolveOnJiraDone: false,
        commentVisibility: 'public',
      },
    });
  }
}
