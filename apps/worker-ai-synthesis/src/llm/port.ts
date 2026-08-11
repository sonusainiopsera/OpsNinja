/**
 * LlmProvider port — the single abstraction boundary between the synthesis
 * worker and any language model backend.
 *
 * Design invariants:
 *  - Adapters are stateless and I/O-only; no domain, DB or queue knowledge.
 *  - Untrusted model output is typed `unknown` until Zod validation succeeds.
 *  - TokenUsage and latency are always returned so callers can record provenance.
 *  - Errors are typed: RetryableLlmError vs NonRetryableLlmError.
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Roles a comment author may hold in a thread. */
export type AuthorRole = 'agent' | 'system' | 'contact';

/** Visibility tier of a comment. */
export type CommentVisibility = 'public' | 'internal';

/** Confidence level returned by the model for each affected area. */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * A single comment in the normalised thread payload.
 * Content fields are Confidential tier — must be redacted before logging.
 */
export interface ThreadComment {
  id: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  authorRole: AuthorRole;
  visibility: CommentVisibility;
  /** Raw comment text — may contain PII; always redacted before sending to the model. */
  body: string;
}

/** Normalised thread payload passed to the LLM. */
export interface SynthesisRequest {
  tenantId: string;
  ticketId: string;
  subject: string;
  thread: ThreadComment[];
}

/** Optional per-request overrides. */
export interface SynthesisOptions {
  /** Override the model ID (e.g. specific Claude version). */
  modelId?: string;
  /** Maximum completion tokens. Default: 1024. */
  maxTokens?: number;
  /** Request timeout in milliseconds. Default: 30 000. */
  timeoutMs?: number;
}

/** A single blast-radius area returned by the model. */
export interface AffectedArea {
  areaLabel: string;
  confidence: ConfidenceLevel;
}

/** Token usage breakdown returned alongside every result. */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Validated result from a successful synthesis call.
 * All content fields are Confidential tier.
 */
export interface SynthesisResult {
  /** One-sentence distillation of the problem. Max 1 200 chars. */
  crux: string;
  /** How the issue was resolved (or current state). Max 2 000 chars. */
  resolution: string;
  /** Up to 10 affected system areas with confidence estimates. */
  affectedAreas: AffectedArea[];
  tokenUsage: TokenUsage;
  /** Identifier of the prompt template used. e.g. "synthesis.v1". */
  promptVersion: string;
  /** Identifier of the model that produced the result. */
  modelId: string;
  /** True when the thread was truncated to fit the context window. */
  truncated: boolean;
  /** Wall-clock time from request start to validated result, in ms. */
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * LlmProvider — single-method port for language model synthesis.
 *
 * Implementations: BedrockLlmProvider, FakeLlmProvider, NoopLlmProvider.
 */
export interface LlmProvider {
  /** Human-readable provider name used in logs and telemetry. */
  readonly name: string;

  /**
   * Synthesizes a ticket thread into structured insights.
   *
   * @throws {RetryableLlmError} on transient failures (throttle, timeout, 5xx, network).
   * @throws {NonRetryableLlmError} on permanent failures (validation, content policy, malformed output).
   */
  synthesize(
    request: SynthesisRequest,
    options?: SynthesisOptions,
  ): Promise<SynthesisResult>;
}
