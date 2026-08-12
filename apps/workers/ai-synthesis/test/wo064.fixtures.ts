/**
 * wo064.fixtures.ts — deterministic fixtures for WO-064 (AC12).
 *
 * Three synthesis scenarios + fake clock helper:
 *   ALWAYS_FAILING    — provider always throws RetryableLlmError
 *   INTERMITTENT      — fails on attempts 1-2, succeeds on attempt 3
 *   STUCK_RUNNING     — row already in 'running' state beyond stale threshold
 *
 * FakeClock allows time-based reconciliation thresholds to be tested
 * deterministically without real sleeps.
 */

import type { SynthesisMessage } from '../src/synthesis.service';
import { RetryableLlmError, NonRetryableLlmError } from '../src/llm-provider.port';
import type { SynthesisRequest, SynthesisResult, LlmProviderPort } from '../src/llm-provider.port';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

export const WO064_TENANT_A     = 'f0640001-0000-4000-8000-000000000001';
export const WO064_TENANT_B     = 'f0640002-0000-4000-8000-000000000002';
export const WO064_TICKET_FAIL  = 'f0640000-0000-4000-8000-000000000010';
export const WO064_TICKET_INTERM = 'f0640000-0000-4000-8000-000000000020';
export const WO064_TICKET_STUCK  = 'f0640000-0000-4000-8000-000000000030';
export const WO064_TICKET_NONRETRY = 'f0640000-0000-4000-8000-000000000040';
export const WO064_SUMMARY_ID_STUCK = 'f0640000-ffff-4000-8000-000000000030';

export const WO064_EVENT_ID_1 = 'ee640001-0000-4000-8000-000000000001';
export const WO064_EVENT_ID_2 = 'ee640001-0000-4000-8000-000000000002';
export const WO064_EVENT_ID_3 = 'ee640001-0000-4000-8000-000000000003';

// ---------------------------------------------------------------------------
// SynthesisMessage fixtures
// ---------------------------------------------------------------------------

/** Always-failing ticket: provider will always throw RetryableLlmError. */
export const MSG_ALWAYS_FAILING: SynthesisMessage = {
  eventId:   WO064_EVENT_ID_1,
  eventType: 'ticket.resolved',
  tenantId:  WO064_TENANT_A,
  ticketId:  WO064_TICKET_FAIL,
  occurredAt: '2026-01-15T10:00:00.000Z',
};

/** Intermittently-failing ticket: fails twice, then succeeds on attempt 3. */
export const MSG_INTERMITTENT: SynthesisMessage = {
  eventId:   WO064_EVENT_ID_2,
  eventType: 'ticket.resolved',
  tenantId:  WO064_TENANT_A,
  ticketId:  WO064_TICKET_INTERM,
  occurredAt: '2026-01-15T11:00:00.000Z',
};

/** Non-retryable failure: provider throws NonRetryableLlmError immediately. */
export const MSG_NON_RETRYABLE: SynthesisMessage = {
  eventId:   WO064_EVENT_ID_3,
  eventType: 'ticket.resolved',
  tenantId:  WO064_TENANT_A,
  ticketId:  WO064_TICKET_NONRETRY,
  occurredAt: '2026-01-15T12:00:00.000Z',
};

/** Malformed SQS message body (missing tenantId). */
export const MSG_MALFORMED_MISSING_TENANT = {
  eventId:   'ee640099-0000-0000-0000-000000000001',
  eventType: 'ticket.resolved',
  // tenantId intentionally omitted
  ticketId:  WO064_TICKET_FAIL,
  occurredAt: '2026-01-15T10:00:00.000Z',
};

/** Malformed SQS message body (missing ticketId). */
export const MSG_MALFORMED_MISSING_TICKET = {
  eventId:   'ee640099-0000-0000-0000-000000000002',
  eventType: 'ticket.resolved',
  tenantId:  WO064_TENANT_A,
  // ticketId intentionally omitted
  occurredAt: '2026-01-15T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Stuck-running DB row fixture
// ---------------------------------------------------------------------------

/** A summary row already in 'running' state for 20 minutes (beyond 15-min threshold). */
export const STUCK_RUNNING_ROW = {
  id:            WO064_SUMMARY_ID_STUCK,
  tenant_id:     WO064_TENANT_A,
  ticket_id:     WO064_TICKET_STUCK,
  ai_status:     'running',
  attempt_count: 1,
  updated_at:    new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
};

/** A summary row in 'running' but at the attempt cap (3 attempts). */
export const STUCK_RUNNING_AT_CAP = {
  id:            'f0640000-ffff-4000-8000-000000000031',
  tenant_id:     WO064_TENANT_A,
  ticket_id:     WO064_TICKET_STUCK,
  ai_status:     'running',
  attempt_count: 3,
  updated_at:    new Date(Date.now() - 20 * 60 * 1000),
};

/** A summary row in 'pending' for 35 minutes (beyond 30-min threshold). */
export const STUCK_PENDING_ROW = {
  id:            'f0640000-ffff-4000-8000-000000000032',
  tenant_id:     WO064_TENANT_A,
  ticket_id:     'f0640000-0000-4000-8000-000000000050',
  ai_status:     'pending',
  attempt_count: 0,
  updated_at:    new Date(Date.now() - 35 * 60 * 1000), // 35 minutes ago
};

/** A healthy 'running' row within the stale threshold (2 minutes old). */
export const HEALTHY_RUNNING_ROW = {
  id:            'f0640000-ffff-4000-8000-000000000033',
  tenant_id:     WO064_TENANT_A,
  ticket_id:     'f0640000-0000-4000-8000-000000000060',
  ai_status:     'running',
  attempt_count: 1,
  updated_at:    new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago — not stale
};

// ---------------------------------------------------------------------------
// LLM provider stubs
// ---------------------------------------------------------------------------

/** Provider that always throws RetryableLlmError. */
export class AlwaysFailingLlmProvider implements LlmProviderPort {
  callCount = 0;
  async synthesise(_req: SynthesisRequest): Promise<SynthesisResult> {
    this.callCount++;
    throw new RetryableLlmError('Model unavailable');
  }
}

/** Provider that throws RetryableLlmError on attempts 1 and 2, succeeds on attempt 3+. */
export class IntermittentLlmProvider implements LlmProviderPort {
  callCount = 0;
  readonly successResult: SynthesisResult = {
    cruxSummary:       'System recovered after transient error.',
    resolutionSummary: 'Issue was self-resolving after provider retry.',
    affectedAreas:     [{ areaLabel: 'Networking', confidence: '0.9' }],
    modelId:           'anthropic.claude-3-haiku-20240307',
    promptVersion:     'v1',
    generatedAt:       new Date('2026-01-15T11:05:00.000Z'),
    promptTokens:      500,
    completionTokens:  100,
  };

  async synthesise(_req: SynthesisRequest): Promise<SynthesisResult> {
    this.callCount++;
    if (this.callCount <= 2) {
      throw new RetryableLlmError(`Transient error on attempt ${this.callCount}`);
    }
    return this.successResult;
  }
}

/** Provider that throws NonRetryableLlmError on any call. */
export class NonRetryableLlmProvider implements LlmProviderPort {
  callCount = 0;
  async synthesise(_req: SynthesisRequest): Promise<SynthesisResult> {
    this.callCount++;
    throw new NonRetryableLlmError('Content policy violation', 'CONTENT_POLICY_VIOLATION');
  }
}

/** Provider that always succeeds (for redrive / recovery tests). */
export class HealthyLlmProvider implements LlmProviderPort {
  callCount = 0;
  readonly result: SynthesisResult = {
    cruxSummary:       'Issue resolved after redrive.',
    resolutionSummary: 'Provider recovered and synthesis completed.',
    affectedAreas:     [{ areaLabel: 'Infrastructure', confidence: '0.95' }],
    modelId:           'anthropic.claude-3-haiku-20240307',
    promptVersion:     'v1',
    generatedAt:       new Date('2026-01-15T12:05:00.000Z'),
    promptTokens:      600,
    completionTokens:  120,
  };

  async synthesise(_req: SynthesisRequest): Promise<SynthesisResult> {
    this.callCount++;
    return this.result;
  }
}

// ---------------------------------------------------------------------------
// FakeClock helper — allows reconciliation time thresholds to be tested
// without real sleeps.
// ---------------------------------------------------------------------------

export class FakeClock {
  private _now: Date;

  constructor(startTime: Date = new Date('2026-01-15T10:00:00.000Z')) {
    this._now = new Date(startTime);
  }

  now(): Date { return new Date(this._now); }

  nowMs(): number { return this._now.getTime(); }

  /** Advance the clock by the given number of minutes. */
  advanceMinutes(minutes: number): void {
    this._now = new Date(this._now.getTime() + minutes * 60_000);
  }

  /** Advance the clock by the given number of milliseconds. */
  advanceMs(ms: number): void {
    this._now = new Date(this._now.getTime() + ms);
  }

  /**
   * Returns a Date that is `minutes` minutes before the clock's current time.
   * Useful for building stale row `updated_at` values.
   */
  minutesAgo(minutes: number): Date {
    return new Date(this._now.getTime() - minutes * 60_000);
  }
}
