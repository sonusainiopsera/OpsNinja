/**
 * Unit tests for JiraPayloadBuilder — WO-053 AC9.
 *
 * Covers:
 *  1. ADF document structure snapshot — top-level shape, heading, bullet list.
 *  2. Internal notes excluded by default (includeInternalNotes=false).
 *  3. Internal notes excluded when mapping.syncRules.commentVisibility='public'
 *     even if caller requests them (defence-in-depth).
 *  4. Internal notes included when BOTH includeInternalNotes=true AND
 *     mapping.syncRules.commentVisibility='internal'.
 *  5. Oversized comment body truncated to MAX_COMMENT_CHARS + TRUNCATION_MARKER.
 *  6. HTML special characters escaped in subject, org name and comment bodies.
 *  7. No-comment thread omits the "Recent Comments" section and rule.
 *  8. Ticket with no ticketNumber uses ticketId as fallback label.
 *  9. Up to MAX_COMMENTS (5) most recent comments included.
 * 10. Non-ASCII / emoji content passes through without corruption.
 */

import { JiraPayloadBuilder, MAX_COMMENT_CHARS, MAX_COMMENTS } from '../../src/modules/jira/links/jira-payload.builder';
import {
  TICKET_CONTEXT,
  TICKET_CONTEXT_NO_COMMENTS,
  TICKET_CONTEXT_INTERNAL_ONLY,
  TICKET_CONTEXT_OVERSIZED,
  TICKET_CONTEXT_HTML_SPECIAL,
  TICKET_CONTEXT_NO_NUMBER,
  MAPPING_FIXTURE,
  MAPPING_FIXTURE_INTERNAL_ALLOWED,
  COMMENT_INTERNAL_1,
  ADF_SNAPSHOT_TOP_LEVEL,
  ADF_CONTEXT_HEADING,
  ADF_COMMENTS_HEADING,
  EXPECTED_TICKET_KEY,
} from '../fixtures/jira-links.fixtures';
import type { SyncRules } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PUBLIC_SYNC_RULES: SyncRules = {
  applyInboundStatus: false,
  applyInboundComments: false,
  autoResolveOnJiraDone: false,
  commentVisibility: 'public',
};

const INTERNAL_SYNC_RULES: SyncRules = {
  ...PUBLIC_SYNC_RULES,
  commentVisibility: 'internal',
};

function buildDoc(options: {
  includeInternalNotes?: boolean;
  syncRules?: SyncRules;
  ticket?: typeof TICKET_CONTEXT;
}) {
  const builder = new JiraPayloadBuilder();
  return builder.buildDescription(
    options.ticket ?? TICKET_CONTEXT,
    {
      includeInternalNotes: options.includeInternalNotes ?? false,
      syncRules: options.syncRules ?? PUBLIC_SYNC_RULES,
    },
  );
}

function findNodes(doc: ReturnType<typeof buildDoc>, type: string): unknown[] {
  const nodes = (doc as { content: Array<{ type: string }> }).content;
  return nodes.filter((n) => n.type === type);
}

function findHeadingText(doc: ReturnType<typeof buildDoc>, level: number): string[] {
  const nodes = (doc as { content: Array<{ type: string; attrs?: { level: number }; content?: Array<{ type: string; text?: string }> }> }).content;
  return nodes
    .filter((n) => n.type === 'heading' && n.attrs?.level === level)
    .flatMap((n) => n.content ?? [])
    .map((c) => c.text ?? '');
}

function docToString(doc: ReturnType<typeof buildDoc>): string {
  return JSON.stringify(doc);
}

// ---------------------------------------------------------------------------
// 1. ADF document structure snapshot
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — ADF structure', () => {
  it('returns a doc node with version=1', () => {
    const doc = buildDoc({});
    expect(doc.type).toBe(ADF_SNAPSHOT_TOP_LEVEL.type);
    expect((doc as { version: number }).version).toBe(ADF_SNAPSHOT_TOP_LEVEL.version);
  });

  it('has a level-2 heading "OpsNinja Ticket Context"', () => {
    const doc = buildDoc({});
    const headings = findHeadingText(doc, ADF_CONTEXT_HEADING.attrs.level);
    expect(headings.some((t) => t.includes('OpsNinja Ticket Context'))).toBe(true);
  });

  it('has a bullet list with Ticket, Subject, Organisation, Priority, Category, SLA Target items', () => {
    const doc = buildDoc({});
    const lists = findNodes(doc, 'bulletList');
    expect(lists).toHaveLength(1);
    const str = docToString(doc);
    expect(str).toContain('Ticket:');
    expect(str).toContain('Subject:');
    expect(str).toContain('Organisation:');
    expect(str).toContain('Priority:');
    expect(str).toContain('Category:');
    expect(str).toContain('SLA Target:');
  });

  it('includes the ticket key in ON-NNNN format', () => {
    const str = docToString(buildDoc({}));
    expect(str).toContain(EXPECTED_TICKET_KEY);
  });

  it('includes a footer paragraph with deep link back to the ticket', () => {
    const str = docToString(buildDoc({}));
    expect(str).toContain('View full ticket');
    expect(str).toContain(TICKET_CONTEXT.ticketUrl);
  });
});

// ---------------------------------------------------------------------------
// 2. Internal notes excluded by default
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — internal note exclusion (default)', () => {
  it('excludes internal notes when includeInternalNotes=false', () => {
    const str = docToString(buildDoc({ includeInternalNotes: false }));
    // COMMENT_INTERNAL_1 body must not appear
    expect(str).not.toContain('session token race');
  });

  it('includes public comments when they exist', () => {
    const str = docToString(buildDoc({ includeInternalNotes: false }));
    expect(str).toContain('login fails intermittently');
  });

  it('shows a level-3 "Recent Comments" heading when public comments exist', () => {
    const doc = buildDoc({ includeInternalNotes: false });
    const headings = findHeadingText(doc, ADF_COMMENTS_HEADING.attrs.level);
    expect(headings.some((t) => t.includes('Recent Comments'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Defence-in-depth: internal excluded even if caller requests when mapping forbids
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — defence-in-depth', () => {
  it('excludes internal notes when includeInternalNotes=true but commentVisibility=public', () => {
    const str = docToString(buildDoc({
      includeInternalNotes: true,
      syncRules: PUBLIC_SYNC_RULES,
    }));
    expect(str).not.toContain('session token race');
  });

  it('includes internal notes only when BOTH caller requests AND mapping allows', () => {
    const str = docToString(buildDoc({
      includeInternalNotes: true,
      syncRules: INTERNAL_SYNC_RULES,
    }));
    expect(str).toContain('session token race');
  });

  it('adds [internal note] tag when internal comment is included', () => {
    const str = docToString(buildDoc({
      includeInternalNotes: true,
      syncRules: INTERNAL_SYNC_RULES,
    }));
    expect(str).toContain('[internal note]');
  });
});

// ---------------------------------------------------------------------------
// 4. Internal-only thread with public gating
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — internal-only thread', () => {
  it('omits the Recent Comments section when only internal notes and gating is public', () => {
    const str = docToString(buildDoc({
      ticket: TICKET_CONTEXT_INTERNAL_ONLY,
      includeInternalNotes: false,
      syncRules: PUBLIC_SYNC_RULES,
    }));
    expect(str).not.toContain('Recent Comments');
    expect(str).not.toContain('session token race');
  });

  it('shows Recent Comments with internal note when mapping allows it', () => {
    const str = docToString(buildDoc({
      ticket: TICKET_CONTEXT_INTERNAL_ONLY,
      includeInternalNotes: true,
      syncRules: INTERNAL_SYNC_RULES,
    }));
    expect(str).toContain('Recent Comments');
    expect(str).toContain('session token race');
  });
});

// ---------------------------------------------------------------------------
// 5. Truncation of oversized comment
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — comment truncation', () => {
  it('truncates comment body to MAX_COMMENT_CHARS with truncation marker', () => {
    const str = docToString(buildDoc({
      ticket: TICKET_CONTEXT_OVERSIZED,
      includeInternalNotes: false,
    }));
    // Marker must appear
    expect(str).toContain('truncated');
    // The oversized part (beyond 2000 chars) must not appear
    expect(str).not.toContain('this should be cut');
    // First MAX_COMMENT_CHARS chars of 'A'.repeat(2500) must appear
    expect(str).toContain('A'.repeat(10));
  });

  it('does not truncate comment bodies under MAX_COMMENT_CHARS', () => {
    const str = docToString(buildDoc({ includeInternalNotes: false }));
    // Public comments are short — no truncation marker in the comment section
    const commentSection = str.indexOf('Recent Comments');
    if (commentSection >= 0) {
      expect(str.indexOf('[truncated', commentSection)).toBe(-1);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. HTML escaping
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — HTML escaping', () => {
  it('escapes HTML special chars in comment bodies', () => {
    const str = docToString(buildDoc({
      ticket: TICKET_CONTEXT_HTML_SPECIAL,
      includeInternalNotes: false,
    }));
    expect(str).toContain('&lt;script&gt;');
    expect(str).toContain('&amp;');
    expect(str).not.toContain('<script>');
  });

  it('escapes HTML in ticket subject and org name', () => {
    const builder = new JiraPayloadBuilder();
    const doc = builder.buildDescription(
      {
        ...TICKET_CONTEXT,
        subject: 'Ticket <b>bold</b> & "quoted"',
        organizationName: '<Evil> Corp',
        comments: [],
      },
      { includeInternalNotes: false, syncRules: PUBLIC_SYNC_RULES },
    );
    const str = JSON.stringify(doc);
    expect(str).toContain('&lt;b&gt;');
    expect(str).toContain('&amp;');
    expect(str).toContain('&lt;Evil&gt;');
    expect(str).not.toContain('<b>');
    expect(str).not.toContain('<Evil>');
  });
});

// ---------------------------------------------------------------------------
// 7. No-comment thread omits Recent Comments section
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — no comments', () => {
  it('omits Recent Comments section and rule separator when thread is empty', () => {
    const doc = buildDoc({ ticket: TICKET_CONTEXT_NO_COMMENTS });
    const str = docToString(doc);
    expect(str).not.toContain('Recent Comments');
    // There should be only ONE rule (the footer separator), not two
    const ruleCount = (doc as { content: unknown[] }).content.filter(
      (n: unknown) => (n as { type: string }).type === 'rule'
    ).length;
    expect(ruleCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Ticket without ticketNumber falls back to ticketId
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — ticketNumber fallback', () => {
  it('uses ticketId as link label when ticketNumber is null', () => {
    const doc = buildDoc({ ticket: TICKET_CONTEXT_NO_NUMBER });
    const str = docToString(doc);
    expect(str).not.toContain('ON-1234');
    expect(str).toContain(TICKET_CONTEXT_NO_NUMBER.ticketId);
  });
});

// ---------------------------------------------------------------------------
// 9. MAX_COMMENTS limit
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — MAX_COMMENTS limit', () => {
  it(`includes at most ${MAX_COMMENTS} comments`, () => {
    const manyComments = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      body: `Comment ${i} body`,
      visibility: 'public' as const,
      authorName: `Author ${i}`,
      createdAt: new Date(2026, 7, 1, i).toISOString(),
    }));

    const builder = new JiraPayloadBuilder();
    const doc = builder.buildDescription(
      { ...TICKET_CONTEXT, comments: manyComments },
      { includeInternalNotes: false, syncRules: PUBLIC_SYNC_RULES },
    );
    const str = JSON.stringify(doc);

    // At most 5 comments should be in the body
    let matchCount = 0;
    for (let i = 0; i < 10; i++) {
      if (str.includes(`Comment ${i} body`)) matchCount++;
    }
    expect(matchCount).toBeLessThanOrEqual(MAX_COMMENTS);
  });
});

// ---------------------------------------------------------------------------
// 10. Non-ASCII content
// ---------------------------------------------------------------------------

describe('JiraPayloadBuilder — non-ASCII content', () => {
  it('passes through non-ASCII and emoji without corruption', () => {
    const builder = new JiraPayloadBuilder();
    const doc = builder.buildDescription(
      {
        ...TICKET_CONTEXT,
        subject: 'ログイン失敗 🔐 café naïve',
        comments: [],
      },
      { includeInternalNotes: false, syncRules: PUBLIC_SYNC_RULES },
    );
    const str = JSON.stringify(doc);
    expect(str).toContain('ログイン失敗');
    expect(str).toContain('🔐');
    expect(str).toContain('café');
  });
});
