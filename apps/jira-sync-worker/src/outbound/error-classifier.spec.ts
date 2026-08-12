/**
 * error-classifier.spec.ts — unit tests for Jira error classification (WO-056 AC9).
 *
 * Pure-function tests — no I/O, no mocking required.
 * Covers: all HTTP status codes, transient vs permanent, Retry-After parsing,
 * workflow-transition detection, network exception classification.
 */

import {
  classifyJiraError,
  classifyException,
  parseRetryAfter,
} from './error-classifier';

// ---------------------------------------------------------------------------
// Transient errors
// ---------------------------------------------------------------------------

describe('classifyJiraError — transient', () => {
  it('408 → transient JIRA_TIMEOUT', () => {
    const c = classifyJiraError(408);
    expect(c.kind).toBe('transient');
    expect(c.code).toBe('JIRA_TIMEOUT');
  });

  it('429 → transient JIRA_RATE_LIMITED', () => {
    const c = classifyJiraError(429);
    expect(c.kind).toBe('transient');
    expect(c.code).toBe('JIRA_RATE_LIMITED');
  });

  it('500 → transient JIRA_SERVER_ERROR', () => {
    const c = classifyJiraError(500);
    expect(c.kind).toBe('transient');
    expect(c.code).toBe('JIRA_SERVER_ERROR');
  });

  it('502 → transient', () => {
    expect(classifyJiraError(502).kind).toBe('transient');
  });

  it('503 → transient', () => {
    expect(classifyJiraError(503).kind).toBe('transient');
  });

  it('504 → transient', () => {
    expect(classifyJiraError(504).kind).toBe('transient');
  });

  it('null httpStatus (network error) → transient JIRA_UNREACHABLE', () => {
    const c = classifyJiraError(null);
    expect(c.kind).toBe('transient');
    expect(c.code).toBe('JIRA_UNREACHABLE');
  });

  it('unlisted 5xx → transient JIRA_SERVER_ERROR', () => {
    const c = classifyJiraError(599);
    expect(c.kind).toBe('transient');
    expect(c.code).toBe('JIRA_SERVER_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Permanent errors
// ---------------------------------------------------------------------------

describe('classifyJiraError — permanent', () => {
  it('400 → permanent JIRA_VALIDATION_ERROR', () => {
    const c = classifyJiraError(400);
    expect(c.kind).toBe('permanent');
    expect(c.code).toBe('JIRA_VALIDATION_ERROR');
  });

  it('401 → permanent JIRA_UNAUTHORIZED', () => {
    const c = classifyJiraError(401);
    expect(c.kind).toBe('permanent');
    expect(c.code).toBe('JIRA_UNAUTHORIZED');
  });

  it('403 → permanent JIRA_FORBIDDEN', () => {
    const c = classifyJiraError(403);
    expect(c.kind).toBe('permanent');
    expect(c.code).toBe('JIRA_FORBIDDEN');
  });

  it('404 → permanent JIRA_NOT_FOUND', () => {
    const c = classifyJiraError(404);
    expect(c.kind).toBe('permanent');
    expect(c.code).toBe('JIRA_NOT_FOUND');
  });

  it('410 → permanent JIRA_GONE', () => {
    const c = classifyJiraError(410);
    expect(c.kind).toBe('permanent');
    expect(c.code).toBe('JIRA_GONE');
  });

  it('422 → permanent JIRA_VALIDATION_ERROR', () => {
    const c = classifyJiraError(422);
    expect(c.kind).toBe('permanent');
    expect(c.code).toBe('JIRA_VALIDATION_ERROR');
  });

  it('unknown 4xx → permanent JIRA_UNKNOWN', () => {
    const c = classifyJiraError(418);
    expect(c.kind).toBe('permanent');
    expect(c.code).toBe('JIRA_UNKNOWN');
  });

  it('400 with transition/workflow body → JIRA_WORKFLOW_TRANSITION_INVALID', () => {
    const c = classifyJiraError(400, null, {
      errors: { transition: 'Transition is not allowed from the current status' },
    });
    expect(c.kind).toBe('permanent');
    expect(c.code).toBe('JIRA_WORKFLOW_TRANSITION_INVALID');
  });

  it('400 with workflow in errorMessages → JIRA_WORKFLOW_TRANSITION_INVALID', () => {
    const c = classifyJiraError(400, null, {
      errorMessages: ['workflow step not available'],
    });
    expect(c.code).toBe('JIRA_WORKFLOW_TRANSITION_INVALID');
  });

  it('400 without transition keywords → JIRA_VALIDATION_ERROR (not workflow)', () => {
    const c = classifyJiraError(400, null, { errors: { summary: 'Field is required' } });
    expect(c.code).toBe('JIRA_VALIDATION_ERROR');
  });

  it('400 with null body → JIRA_VALIDATION_ERROR', () => {
    const c = classifyJiraError(400, null, null);
    expect(c.code).toBe('JIRA_VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Retry-After header on 429
// ---------------------------------------------------------------------------

describe('classifyJiraError — Retry-After header', () => {
  it('extracts numeric Retry-After seconds on 429', () => {
    const c = classifyJiraError(429, '45');
    expect(c.retryAfterSeconds).toBe(45);
  });

  it('retryAfterSeconds absent for non-429 even with Retry-After header', () => {
    const c = classifyJiraError(500, '30');
    expect(c.retryAfterSeconds).toBeUndefined();
  });

  it('retryAfterSeconds absent when header is null', () => {
    const c = classifyJiraError(429, null);
    expect(c.retryAfterSeconds).toBeUndefined();
  });

  it('retryAfterSeconds absent when header is empty string', () => {
    const c = classifyJiraError(429, '');
    expect(c.retryAfterSeconds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseRetryAfter helper
// ---------------------------------------------------------------------------

describe('parseRetryAfter', () => {
  it('returns number for integer string', () => {
    expect(parseRetryAfter('60')).toBe(60);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('120')).toBe(120);
  });

  it('returns undefined for null', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseRetryAfter('')).toBeUndefined();
  });

  it('returns undefined for non-numeric non-date string', () => {
    expect(parseRetryAfter('not-a-date')).toBeUndefined();
  });

  it('returns positive seconds for future HTTP-date', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const result = parseRetryAfter(future);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(31); // some tolerance for test execution time
  });
});

// ---------------------------------------------------------------------------
// classifyException
// ---------------------------------------------------------------------------

describe('classifyException', () => {
  it('AbortError → transient JIRA_TIMEOUT', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const c = classifyException(err);
    expect(c.kind).toBe('transient');
    expect(c.code).toBe('JIRA_TIMEOUT');
  });

  it('message containing "timeout" → JIRA_TIMEOUT', () => {
    const c = classifyException(new Error('connect timeout after 10000ms'));
    expect(c.code).toBe('JIRA_TIMEOUT');
  });

  it('generic network error → transient JIRA_UNREACHABLE', () => {
    const c = classifyException(new Error('ECONNREFUSED 127.0.0.1:8080'));
    expect(c.kind).toBe('transient');
    expect(c.code).toBe('JIRA_UNREACHABLE');
  });

  it('non-Error value → transient JIRA_UNREACHABLE', () => {
    const c = classifyException('something failed');
    expect(c.kind).toBe('transient');
    expect(c.code).toBe('JIRA_UNREACHABLE');
  });
});
