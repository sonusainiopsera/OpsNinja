/**
 * Prompt assembler — pure functions for rendering the versioned synthesis template.
 *
 * Responsibilities:
 *  - Load and cache the versioned template from disk (once per process).
 *  - Apply deterministic truncation for oversized threads: always retain
 *    the first comment (description) and the last N comments, dropping
 *    oldest middle comments.
 *  - Render the template with the (possibly truncated, always redacted) thread.
 *  - Return the assembled prompt string and the prompt_version identifier.
 *
 * No I/O after initial template load; all rendering is pure.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThreadComment, SynthesisRequest } from './port.js';
import { redactText, redactThread } from './redaction.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Approximate tokens per character (conservative UTF-8 average). */
const CHARS_PER_TOKEN = 4;

/** Default maximum prompt characters before truncation kicks in. */
const DEFAULT_MAX_PROMPT_CHARS = 60_000;

/** Number of most-recent comments always retained after the first comment. */
const RETAINED_RECENT_COUNT = 10;

/** Prompt version identifier embedded in every result. */
export const PROMPT_VERSION = 'synthesis.v1';

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, 'prompts', 'synthesis.v1.txt');

let _cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (_cachedTemplate === null) {
    _cachedTemplate = readFileSync(TEMPLATE_PATH, 'utf8');
  }
  return _cachedTemplate;
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

export interface TruncationResult {
  comments: ThreadComment[];
  truncated: boolean;
  droppedCount: number;
}

/**
 * Deterministically truncates a thread to fit within maxChars.
 *
 * Strategy:
 *  1. Always retain the first comment (ticket description).
 *  2. Always retain the last RETAINED_RECENT_COUNT comments (most recent context).
 *  3. Drop oldest middle comments until the thread fits.
 */
export function truncateThread(
  comments: readonly ThreadComment[],
  maxChars = DEFAULT_MAX_PROMPT_CHARS,
): TruncationResult {
  const totalChars = comments.reduce((sum, c) => sum + c.body.length, 0);
  if (totalChars <= maxChars) {
    return { comments: [...comments], truncated: false, droppedCount: 0 };
  }

  if (comments.length <= 2) {
    return { comments: [...comments], truncated: false, droppedCount: 0 };
  }

  const first = comments[0];
  if (!first) {
    return { comments: [], truncated: false, droppedCount: 0 };
  }

  const recentStart = Math.max(1, comments.length - RETAINED_RECENT_COUNT);
  const recent = comments.slice(recentStart);
  const middle = comments.slice(1, recentStart);

  // Always-retained characters
  const fixedChars = first.body.length + recent.reduce((s, c) => s + c.body.length, 0);

  let budget = maxChars - fixedChars;
  let droppedCount = 0;
  const keptMiddle: ThreadComment[] = [];

  // Keep middle comments from newest-to-oldest until budget runs out
  for (let i = middle.length - 1; i >= 0; i--) {
    const c = middle[i];
    if (c === undefined) continue;
    if (budget - c.body.length >= 0) {
      budget -= c.body.length;
      keptMiddle.unshift(c);
    } else {
      droppedCount++;
    }
  }

  const result = [first, ...keptMiddle, ...recent];
  return {
    comments: result,
    truncated: droppedCount > 0,
    droppedCount,
  };
}

// ---------------------------------------------------------------------------
// Thread rendering
// ---------------------------------------------------------------------------

function renderThread(comments: readonly ThreadComment[]): string {
  return comments
    .map((c, idx) => {
      const marker = `[${idx + 1}] ${c.createdAt} (${c.authorRole}, ${c.visibility})`;
      return `${marker}\n${c.body}`;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

export interface AssembledPrompt {
  /** Full prompt string ready to send to the model. */
  prompt: string;
  /** Identifier of the template version used. */
  promptVersion: string;
  /** True if the thread was truncated to fit the context window. */
  truncated: boolean;
  /** Estimated token count (rough). */
  estimatedTokens: number;
}

/**
 * Assembles the versioned prompt from a SynthesisRequest.
 *
 * Steps:
 *  1. Redact PII from thread comment bodies and subject.
 *  2. Truncate if thread exceeds maxChars.
 *  3. Render thread to text.
 *  4. Substitute template variables.
 */
export function assemblePrompt(
  request: SynthesisRequest,
  opts: { maxChars?: number } = {},
): AssembledPrompt {
  const template = loadTemplate();
  const maxChars = opts.maxChars ?? DEFAULT_MAX_PROMPT_CHARS;

  // Step 1: Redact
  const redactedSubject = redactText(request.subject);
  const redactedThread = redactThread(request.thread);

  // Step 2: Truncate
  const { comments, truncated, droppedCount } = truncateThread(redactedThread, maxChars);

  // Step 3: Render
  const threadBody = renderThread(comments);
  const truncatedNote = droppedCount > 0 ? `, ${droppedCount} middle comment(s) omitted` : '';

  // Step 4: Substitute
  const prompt = template
    .replace('{{SUBJECT}}', redactedSubject)
    .replace('{{COMMENT_COUNT}}', String(comments.length))
    .replace('{{TRUNCATED_NOTE}}', truncatedNote)
    .replace('{{THREAD_BODY}}', threadBody);

  const estimatedTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN);

  return { prompt, promptVersion: PROMPT_VERSION, truncated, estimatedTokens };
}
