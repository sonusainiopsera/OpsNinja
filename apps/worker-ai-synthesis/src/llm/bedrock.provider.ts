/**
 * BedrockLlmProvider — AWS Bedrock Runtime adapter for the LlmProvider port.
 *
 * I/O-only: delegates all business logic (prompt assembly, redaction,
 * validation) to the pure functional core modules.
 *
 * Auth: IRSA-scoped IAM role (no credentials in code or config).
 * Transport: VPC endpoint URL configured via BEDROCK_ENDPOINT_URL env var.
 * Timeout: per-request AbortController (default 30 s).
 * Model: Bedrock Converse API supporting any Claude or Titan model.
 *
 * Token usage extraction: from response.usage (Converse API format).
 * Telemetry: optional LlmTracer injection; span name "llm.synthesize".
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { LlmProvider, SynthesisRequest, SynthesisOptions, SynthesisResult } from './port.js';
import { assemblePrompt, PROMPT_VERSION } from './prompt-assembler.js';
import { parseAndValidate } from './schema.js';
import { classifyProviderError, RetryableLlmError } from './errors.js';
import type { LlmTracer } from './telemetry.js';
import { NOOP_TRACER } from './telemetry.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BedrockProviderConfig {
  /** Default model ARN or ID. e.g. "anthropic.claude-3-5-sonnet-20241022-v2:0" */
  defaultModelId: string;
  /** VPC endpoint URL for Bedrock Runtime. If omitted, uses the public endpoint. */
  endpointUrl?: string;
  /** AWS region. Defaults to process.env.AWS_REGION. */
  region?: string;
  /** Default completion token limit. Defaults to 1024. */
  defaultMaxTokens?: number;
  /** Default timeout per request in ms. Defaults to 30 000. */
  defaultTimeoutMs?: number;
}

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Converse API response shape (subset we use)
// ---------------------------------------------------------------------------

interface ConverseUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface ConverseContentBlock {
  text?: string;
}

interface ConverseMessage {
  role?: string;
  content?: ConverseContentBlock[];
}

interface ConverseOutput {
  message?: ConverseMessage;
}

interface ConverseResponse {
  output?: ConverseOutput;
  usage?: ConverseUsage;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class BedrockLlmProvider implements LlmProvider {
  readonly name = 'bedrock';

  private readonly client: BedrockRuntimeClient;
  private readonly config: Required<Omit<BedrockProviderConfig, 'endpointUrl'>> & { endpointUrl?: string };
  private readonly tracer: LlmTracer;

  constructor(config: BedrockProviderConfig, tracer: LlmTracer = NOOP_TRACER) {
    this.config = {
      defaultModelId:    config.defaultModelId,
      endpointUrl:       config.endpointUrl,
      region:            config.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
      defaultMaxTokens:  config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
      defaultTimeoutMs:  config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    this.tracer = tracer;

    this.client = new BedrockRuntimeClient({
      region: this.config.region,
      // IRSA-scoped credentials are picked up automatically from the environment;
      // no explicit credential provider is set here.
      ...(config.endpointUrl
        ? { endpoint: config.endpointUrl }
        : {}),
    });
  }

  async synthesize(
    request: SynthesisRequest,
    options?: SynthesisOptions,
  ): Promise<SynthesisResult> {
    const modelId    = options?.modelId    ?? this.config.defaultModelId;
    const maxTokens  = options?.maxTokens  ?? this.config.defaultMaxTokens;
    const timeoutMs  = options?.timeoutMs  ?? this.config.defaultTimeoutMs;

    const span = this.tracer.startSpan('llm.synthesize');
    const startMs = Date.now();

    const traceId = `${request.tenantId}:${request.ticketId}`;

    // Assemble prompt (redaction + truncation + template rendering)
    const { prompt, promptVersion, truncated } = assemblePrompt(request);

    // Per-request abort controller for timeout enforcement
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      timeoutMs,
    );

    let rawText: string;
    let usage: ConverseUsage;

    try {
      const input: ConverseCommandInput = {
        modelId,
        messages: [
          {
            role: 'user',
            content: [{ text: prompt }],
          } as Message,
        ],
        inferenceConfig: {
          maxTokens,
          temperature: 0,   // deterministic output for structured JSON
        },
      };

      const command = new ConverseCommand(input);
      const response = await this.client.send(command, {
        abortSignal: abortController.signal,
      }) as ConverseResponse;

      const contentBlock = response.output?.message?.content?.[0];
      rawText = contentBlock?.text ?? '';
      usage = response.usage ?? {};
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      const classified = classifyProviderError(err, traceId);
      const latencyMs = Date.now() - startMs;

      span.setAttributes({
        provider:      this.name,
        modelId,
        promptVersion,
        inputTokens:   0,
        outputTokens:  0,
        durationMs:    latencyMs,
        outcome:       classified.retryable ? 'retryable_error' : 'non_retryable_error',
      });
      span.setStatus('error', classified.code);
      span.end();

      throw classified;
    } finally {
      clearTimeout(timeoutHandle);
    }

    // Check if we aborted (AbortError may not always throw in some environments)
    if (abortController.signal.aborted) {
      const latencyMs = Date.now() - startMs;
      span.setAttributes({
        provider: this.name, modelId, promptVersion,
        inputTokens: 0, outputTokens: 0, durationMs: latencyMs,
        outcome: 'retryable_error',
      });
      span.setStatus('error', 'REQUEST_TIMEOUT');
      span.end();
      throw new RetryableLlmError('REQUEST_TIMEOUT', 'Request timed out.', undefined, traceId);
    }

    // Validate model output (Zod)
    const validated = parseAndValidate(rawText, traceId);

    const inputTokens  = usage.inputTokens  ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const latencyMs    = Date.now() - startMs;

    span.setAttributes({
      provider:      this.name,
      modelId,
      promptVersion,
      inputTokens,
      outputTokens,
      durationMs:    latencyMs,
      outcome:       'success',
    });
    span.setStatus('ok');
    span.end();

    return {
      crux:          validated.crux,
      resolution:    validated.resolution,
      affectedAreas: validated.affected_areas.map((a) => ({
        areaLabel:  a.area_label,
        confidence: a.confidence,
      })),
      tokenUsage: {
        input:  inputTokens,
        output: outputTokens,
        total:  inputTokens + outputTokens,
      },
      promptVersion: promptVersion ?? PROMPT_VERSION,
      modelId,
      truncated,
      latencyMs,
    };
  }
}
