/**
 * Telemetry helpers — OpenTelemetry span and metric instrumentation.
 *
 * Design:
 *  - Uses the @opentelemetry/api trace and metrics APIs only.
 *  - Degrades gracefully to no-ops when the OTel SDK is not registered
 *    (i.e., in unit tests and local dev without a collector).
 *  - NEVER attaches prompt text, thread content, or completion text to spans
 *    or metrics — only token counts, duration, model id, and outcome codes.
 */

import type * as otelApi from '@opentelemetry/api';

// ---------------------------------------------------------------------------
// Lazy-loaded OTel API (no-op if package unavailable)
// ---------------------------------------------------------------------------

let _trace: typeof otelApi.trace | null = null;

function getTrace(): typeof otelApi.trace | null {
  if (_trace !== null) return _trace;
  try {
    // Dynamic import so tests that don't install the package still run.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require('@opentelemetry/api') as typeof otelApi;
    _trace = api.trace;
    return _trace;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Span attributes (safe — no content)
// ---------------------------------------------------------------------------

export interface LlmSpanAttributes {
  provider: string;
  modelId: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  outcome: 'success' | 'retryable_error' | 'non_retryable_error';
}

// ---------------------------------------------------------------------------
// Tracer port (injectable for testing)
// ---------------------------------------------------------------------------

export interface LlmTracer {
  startSpan(name: string): LlmSpan;
}

export interface LlmSpan {
  setAttributes(attrs: LlmSpanAttributes): void;
  setStatus(code: 'ok' | 'error', message?: string): void;
  end(): void;
}

// ---------------------------------------------------------------------------
// OTel-backed tracer implementation
// ---------------------------------------------------------------------------

class OtelLlmSpan implements LlmSpan {
  constructor(private readonly span: otelApi.Span) {}

  setAttributes(attrs: LlmSpanAttributes): void {
    this.span.setAttributes({
      'llm.provider':       attrs.provider,
      'llm.model_id':       attrs.modelId,
      'llm.prompt_version': attrs.promptVersion,
      'llm.input_tokens':   attrs.inputTokens,
      'llm.output_tokens':  attrs.outputTokens,
      'llm.duration_ms':    attrs.durationMs,
      'llm.outcome':        attrs.outcome,
    });
  }

  setStatus(code: 'ok' | 'error', message?: string): void {
    const traceApi = getTrace();
    if (!traceApi) return;
    try {
      const api = require('@opentelemetry/api') as typeof otelApi;
      this.span.setStatus({
        code: code === 'ok' ? api.SpanStatusCode.OK : api.SpanStatusCode.ERROR,
        message,
      });
    } catch { /* no-op */ }
  }

  end(): void {
    this.span.end();
  }
}

class OtelLlmTracer implements LlmTracer {
  private readonly tracer: otelApi.Tracer;

  constructor(name: string, version: string) {
    const traceApi = getTrace();
    this.tracer = traceApi
      ? traceApi.getTracer(name, version)
      : (require('@opentelemetry/api') as typeof otelApi).trace.getTracer(name, version);
  }

  startSpan(name: string): LlmSpan {
    return new OtelLlmSpan(this.tracer.startSpan(name));
  }
}

// ---------------------------------------------------------------------------
// No-op implementations (used in tests and when SDK not loaded)
// ---------------------------------------------------------------------------

class NoopSpan implements LlmSpan {
  setAttributes(_attrs: LlmSpanAttributes): void { /* no-op */ }
  setStatus(_code: 'ok' | 'error', _message?: string): void { /* no-op */ }
  end(): void { /* no-op */ }
}

class NoopTracer implements LlmTracer {
  startSpan(_name: string): LlmSpan {
    return new NoopSpan();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const NOOP_TRACER: LlmTracer = new NoopTracer();

/**
 * Creates an OTel-backed tracer, falling back to a no-op when the SDK
 * is not registered or the package is not installed.
 */
export function createLlmTracer(name = '@opsninja/worker-ai-synthesis', version = '0.0.1'): LlmTracer {
  try {
    return new OtelLlmTracer(name, version);
  } catch {
    return NOOP_TRACER;
  }
}
