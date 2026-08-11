/**
 * LlmProvider port — injectable interface for AI inference.
 *
 * Kept as a pure interface so the worker core never depends on Bedrock
 * directly; the adapter is swapped in tests with FakeLlmProvider.
 */

export const LLM_PROVIDER = 'LLM_PROVIDER';

// ---------------------------------------------------------------------------
// Request / response DTOs
// ---------------------------------------------------------------------------

export interface ThreadMessage {
  role: 'agent' | 'portal_user' | 'system';
  visibility: 'public' | 'internal';
  body: string;
  createdAt: string; // ISO-8601
}

export interface SynthesisRequest {
  ticketId: string;
  tenantId: string;
  subject: string;
  description: string | null;
  priority: string;
  categoryPath: string | null;
  organizationName: string;
  messages: ThreadMessage[];
  /** True when messages were deterministically truncated due to length. */
  truncated: boolean;
}

export interface AffectedArea {
  areaLabel: string;
  /** Floating-point string [0,1]. */
  confidence: string;
}

export interface SynthesisResult {
  cruxSummary: string;
  resolutionSummary: string;
  affectedAreas: AffectedArea[];
  modelId: string;
  promptVersion: string;
  promptTokens: number;
  completionTokens: number;
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Transient error — SQS redelivery will retry. */
export class RetryableLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableLlmError';
  }
}

/** Permanent error — no retry; record last_error_code. */
export class NonRetryableLlmError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
  ) {
    super(message);
    this.name = 'NonRetryableLlmError';
  }
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface LlmProviderPort {
  synthesise(request: SynthesisRequest): Promise<SynthesisResult>;
}
