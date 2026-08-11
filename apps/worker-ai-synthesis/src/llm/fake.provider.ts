/**
 * Test doubles for LlmProvider.
 *
 * NoopLlmProvider     — always throws NonRetryableLlmError; use when synthesis
 *                       must never actually run (strict test environments).
 *
 * FakeLlmProvider     — returns a deterministic SynthesisResult derived from
 *                       the request contents; records all calls for assertion;
 *                       configurable to throw retryable or non-retryable errors.
 *
 * DeterministicFakeLlmProvider — alias for FakeLlmProvider with a canned
 *                       fixture response. Useful in dependency-injected NestJS
 *                       modules where a stable provider is needed.
 */

import type { LlmProvider, SynthesisRequest, SynthesisOptions, SynthesisResult } from './port.js';
import { NonRetryableLlmError, RetryableLlmError } from './errors.js';
import { PROMPT_VERSION } from './prompt-assembler.js';

// ---------------------------------------------------------------------------
// NoopLlmProvider
// ---------------------------------------------------------------------------

export class NoopLlmProvider implements LlmProvider {
  readonly name = 'noop';

  synthesize(_request: SynthesisRequest, _options?: SynthesisOptions): Promise<SynthesisResult> {
    return Promise.reject(
      new NonRetryableLlmError(
        'MALFORMED_OUTPUT',
        'NoopLlmProvider: synthesis is disabled in this environment.',
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// FakeLlmProvider
// ---------------------------------------------------------------------------

export interface FakeProviderCall {
  request: SynthesisRequest;
  options?: SynthesisOptions;
  calledAt: number;
}

export interface FakeProviderConfig {
  /**
   * If set, synthesize() throws this error instead of returning a result.
   * Use RetryableLlmError or NonRetryableLlmError instances.
   */
  throwError?: Error;
  /** Simulated latency in ms. Default: 0. */
  latencyMs?: number;
  /** Override the returned result fields. */
  resultOverride?: Partial<SynthesisResult>;
}

/**
 * Deterministic fake LLM provider for unit and integration tests.
 *
 * Default behaviour: derives crux from the ticket subject, returns a canned
 * set of affected areas, and records every call for assertion.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';

  private readonly calls: FakeProviderCall[] = [];
  private readonly config: FakeProviderConfig;

  constructor(config: FakeProviderConfig = {}) {
    this.config = config;
  }

  get callHistory(): ReadonlyArray<FakeProviderCall> {
    return this.calls;
  }

  get callCount(): number {
    return this.calls.length;
  }

  resetCalls(): void {
    this.calls.length = 0;
  }

  async synthesize(request: SynthesisRequest, options?: SynthesisOptions): Promise<SynthesisResult> {
    this.calls.push({ request, options, calledAt: Date.now() });

    if (this.config.latencyMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.config.latencyMs));
    }

    if (this.config.throwError) {
      throw this.config.throwError;
    }

    const modelId = options?.modelId ?? 'fake.model.v1';

    const defaultResult: SynthesisResult = {
      crux:       `Automated summary for ticket ${request.ticketId}: ${request.subject.slice(0, 80)}`,
      resolution: `Ticket ${request.ticketId} processed by fake provider. ${request.thread.length} comment(s) in thread.`,
      affectedAreas: [
        { areaLabel: 'Core Platform', confidence: 'medium' },
      ],
      tokenUsage: {
        input:  request.thread.reduce((sum, c) => sum + Math.ceil(c.body.length / 4), 0),
        output: 120,
        total:  request.thread.reduce((sum, c) => sum + Math.ceil(c.body.length / 4), 0) + 120,
      },
      promptVersion: PROMPT_VERSION,
      modelId,
      truncated: false,
      latencyMs: this.config.latencyMs ?? 1,
    };

    return { ...defaultResult, ...this.config.resultOverride };
  }
}

// ---------------------------------------------------------------------------
// DeterministicFakeLlmProvider (NestJS DI alias)
// ---------------------------------------------------------------------------

/**
 * A FakeLlmProvider pre-configured with a fixed canned response suitable
 * for deterministic integration tests and local development.
 */
export class DeterministicFakeLlmProvider extends FakeLlmProvider {
  override readonly name = 'deterministic-fake';

  constructor() {
    super({
      resultOverride: {
        crux: 'Deployment pipeline failed due to a misconfigured environment variable in the staging cluster.',
        resolution: 'The environment variable DEPLOY_TOKEN was rotated but not updated in the CI configuration. Updated and re-ran the pipeline successfully.',
        affectedAreas: [
          { areaLabel: 'CI/CD Pipeline', confidence: 'high' },
          { areaLabel: 'Staging Environment', confidence: 'high' },
        ],
        tokenUsage: { input: 1024, output: 256, total: 1280 },
        promptVersion: PROMPT_VERSION,
        modelId: 'deterministic-fake.v1',
        truncated: false,
        latencyMs: 1,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Provider factory helper
// ---------------------------------------------------------------------------

export type ProviderName = 'bedrock' | 'fake' | 'deterministic-fake' | 'noop';

/**
 * Selects the appropriate provider by name for dependency injection.
 * The Bedrock provider is imported lazily to avoid loading the AWS SDK
 * in test environments.
 */
export async function createProvider(
  name: ProviderName,
  bedrockConfig?: import('./bedrock.provider.js').BedrockProviderConfig,
): Promise<LlmProvider> {
  switch (name) {
    case 'bedrock': {
      if (!bedrockConfig) {
        throw new Error('createProvider: bedrockConfig is required for the bedrock provider.');
      }
      const { BedrockLlmProvider } = await import('./bedrock.provider.js');
      return new BedrockLlmProvider(bedrockConfig);
    }
    case 'fake':
      return new FakeLlmProvider();
    case 'deterministic-fake':
      return new DeterministicFakeLlmProvider();
    case 'noop':
    default:
      return new NoopLlmProvider();
  }
}

// Re-export so callers can use these error classes for test configuration.
export { RetryableLlmError, NonRetryableLlmError };
