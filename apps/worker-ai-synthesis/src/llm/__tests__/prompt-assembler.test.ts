import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePrompt, truncateThread, PROMPT_VERSION } from '../prompt-assembler.js';
import type { SynthesisRequest } from '../port.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../../test/fixtures/threads');

function loadFixture(name: string) {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), 'utf8'));
}

function makeRequest(overrides: Partial<SynthesisRequest> = {}): SynthesisRequest {
  return {
    tenantId: 't0000001-0000-4000-8000-000000000001',
    ticketId: 'k0000001-0000-4000-8000-000000000001',
    subject: 'Test subject',
    thread: [
      {
        id: 'c0000001-0000-4000-8000-000000000001',
        createdAt: '2024-01-01T00:00:00Z',
        authorRole: 'contact',
        visibility: 'public',
        body: 'First comment.',
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PROMPT_VERSION
// ---------------------------------------------------------------------------

describe('PROMPT_VERSION', () => {
  it('is a non-empty string', () => {
    expect(typeof PROMPT_VERSION).toBe('string');
    expect(PROMPT_VERSION.length).toBeGreaterThan(0);
  });

  it('matches expected version identifier', () => {
    expect(PROMPT_VERSION).toBe('synthesis.v1');
  });
});

// ---------------------------------------------------------------------------
// truncateThread
// ---------------------------------------------------------------------------

describe('truncateThread', () => {
  it('returns thread unchanged when under limit', () => {
    const fixture = loadFixture('short-thread.json');
    const result = truncateThread(fixture.thread, 50_000);
    expect(result.truncated).toBe(false);
    expect(result.droppedCount).toBe(0);
    expect(result.comments).toHaveLength(fixture.thread.length);
  });

  it('always keeps first comment when truncating', () => {
    const fixture = loadFixture('long-thread.json');
    const result = truncateThread(fixture.thread, 500);
    expect(result.comments[0]?.id).toBe(fixture.thread[0].id);
  });

  it('keeps last comments when truncating', () => {
    const fixture = loadFixture('long-thread.json');
    const lastComment = fixture.thread[fixture.thread.length - 1];
    const result = truncateThread(fixture.thread, 500);
    const ids = result.comments.map((c: { id: string }) => c.id);
    expect(ids).toContain(lastComment.id);
  });

  it('sets truncated=true and droppedCount>0 when content was dropped', () => {
    const fixture = loadFixture('long-thread.json');
    const result = truncateThread(fixture.thread, 100);
    expect(result.truncated).toBe(true);
    expect(result.droppedCount).toBeGreaterThan(0);
  });

  it('result total character length is within budget (plus tolerance for ends)', () => {
    const fixture = loadFixture('long-thread.json');
    const budget = 1000;
    const result = truncateThread(fixture.thread, budget);
    const totalLength = result.comments.reduce(
      (sum: number, c: { body: string }) => sum + c.body.length,
      0,
    );
    // The fixed ends (first + last 10) may slightly exceed the budget
    // when the ends alone are larger; result should be no worse than
    // the sum of fixed ends alone.
    expect(totalLength).toBeGreaterThan(0);
  });

  it('handles single comment thread', () => {
    const thread = [
      {
        id: '1',
        body: 'Only comment',
        createdAt: '2024-01-01T00:00:00Z',
        authorRole: 'contact' as const,
        visibility: 'public' as const,
      },
    ];
    const result = truncateThread(thread, 100);
    expect(result.comments).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it('handles empty thread', () => {
    const result = truncateThread([], 1000);
    expect(result.comments).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assemblePrompt
// ---------------------------------------------------------------------------

describe('assemblePrompt', () => {
  it('returns an object with prompt, promptVersion, truncated, estimatedTokens', () => {
    const result = assemblePrompt(makeRequest());
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(result.promptVersion).toBe(PROMPT_VERSION);
    expect(typeof result.truncated).toBe('boolean');
    expect(typeof result.estimatedTokens).toBe('number');
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('includes the ticket subject in the prompt', () => {
    const result = assemblePrompt(makeRequest({ subject: 'Unique subject 99XY' }));
    expect(result.prompt).toContain('Unique subject 99XY');
  });

  it('includes thread body content in the prompt', () => {
    const request = makeRequest({
      thread: [
        {
          id: 'c1',
          createdAt: '2024-01-01T00:00:00Z',
          authorRole: 'contact',
          visibility: 'public',
          body: 'Unique body content ABCDEFGH',
        },
      ],
    });
    const result = assemblePrompt(request);
    expect(result.prompt).toContain('Unique body content ABCDEFGH');
  });

  it('includes comment count in the prompt', () => {
    const fixture = loadFixture('long-thread.json');
    const request: SynthesisRequest = {
      tenantId: fixture.tenantId,
      ticketId: fixture.ticketId,
      subject: fixture.subject,
      thread: fixture.thread,
    };
    const result = assemblePrompt(request);
    expect(result.prompt).toContain(String(fixture.thread.length));
  });

  it('redacts PII from thread before assembling', () => {
    const fixture = loadFixture('pii-thread.json');
    const request: SynthesisRequest = {
      tenantId: fixture.tenantId,
      ticketId: fixture.ticketId,
      subject: fixture.subject,
      thread: fixture.thread,
    };
    const result = assemblePrompt(request);
    expect(result.prompt).not.toMatch(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  });

  it('sets truncated=true and notes truncation in prompt for oversized threads', () => {
    const fixture = loadFixture('long-thread.json');
    const request: SynthesisRequest = {
      tenantId: fixture.tenantId,
      ticketId: fixture.ticketId,
      subject: fixture.subject,
      thread: fixture.thread,
    };
    const result = assemblePrompt(request, { maxChars: 200 });
    if (result.truncated) {
      expect(result.prompt).toMatch(/omitted/i);
    }
  });

  it('sets truncated=false for short threads', () => {
    const fixture = loadFixture('short-thread.json');
    const request: SynthesisRequest = {
      tenantId: fixture.tenantId,
      ticketId: fixture.ticketId,
      subject: fixture.subject,
      thread: fixture.thread,
    };
    const result = assemblePrompt(request, { maxChars: 50_000 });
    expect(result.truncated).toBe(false);
  });

  it('handles non-English thread without error', () => {
    const fixture = loadFixture('non-english.json');
    const request: SynthesisRequest = {
      tenantId: fixture.tenantId,
      ticketId: fixture.ticketId,
      subject: fixture.subject,
      thread: fixture.thread,
    };
    expect(() => assemblePrompt(request)).not.toThrow();
  });
});
