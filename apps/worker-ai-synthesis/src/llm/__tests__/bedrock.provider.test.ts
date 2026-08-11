import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../../test/fixtures/threads');

// ---------------------------------------------------------------------------
// Stub the Bedrock SDK before any other imports that reference it
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  ConverseCommand: vi.fn().mockImplementation((input: unknown) => ({ _input: input })),
}));

// After mocking, import the module under test
import { BedrockLlmProvider } from '../bedrock.provider.js';
import type { BedrockProviderConfig } from '../bedrock.provider.js';
import type { SynthesisRequest } from '../port.js';
import {
  RetryableLlmError,
  NonRetryableLlmError,
} from '../errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string) {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), 'utf8'));
}

function loadCanned(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, 'canned-response.json'), 'utf8'));
}

function makeConfig(overrides: Partial<BedrockProviderConfig> = {}): BedrockProviderConfig {
  return {
    defaultModelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    region: 'us-east-1',
    defaultTimeoutMs: 5_000,
    ...overrides,
  };
}

function makeRequest(fixture = 'short-thread.json'): SynthesisRequest {
  const f = loadFixture(fixture);
  return {
    tenantId: f.tenantId,
    ticketId: f.ticketId,
    subject: f.subject,
    thread: f.thread,
  };
}

function makeBedrockResponse(text: string) {
  return {
    output: {
      message: {
        role: 'assistant',
        content: [{ text }],
      },
    },
    usage: {
      inputTokens: 512,
      outputTokens: 128,
      totalTokens: 640,
    },
  };
}

// ---------------------------------------------------------------------------
// Constructor / SDK wiring
// ---------------------------------------------------------------------------

describe('BedrockLlmProvider constructor', () => {
  it('exposes name="bedrock"', () => {
    const provider = new BedrockLlmProvider(makeConfig());
    expect(provider.name).toBe('bedrock');
  });

  it('passes VPC endpoint URL to SDK client when configured', () => {
    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    new BedrockLlmProvider(makeConfig({ endpointUrl: 'https://bedrock.vpc.example.com' }));
    expect(BedrockRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://bedrock.vpc.example.com' }),
    );
  });

  it('does not pass endpoint key when endpointUrl is omitted', () => {
    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    vi.clearAllMocks();
    new BedrockLlmProvider(makeConfig());
    const ctorArgs = (BedrockRuntimeClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(ctorArgs).not.toHaveProperty('endpoint');
  });
});

// ---------------------------------------------------------------------------
// Successful synthesis
// ---------------------------------------------------------------------------

describe('BedrockLlmProvider.synthesize — success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ConverseCommand with the model ID from config', async () => {
    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(JSON.stringify(canned.validResponse)));

    const provider = new BedrockLlmProvider(makeConfig());
    await provider.synthesize(makeRequest());

    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }),
    );
  });

  it('overrides modelId from options', async () => {
    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(JSON.stringify(canned.validResponse)));

    const provider = new BedrockLlmProvider(makeConfig());
    await provider.synthesize(makeRequest(), { modelId: 'amazon.titan-text-express-v1' });

    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'amazon.titan-text-express-v1' }),
    );
  });

  it('sends exactly one message with role=user', async () => {
    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(JSON.stringify(canned.validResponse)));

    const provider = new BedrockLlmProvider(makeConfig());
    await provider.synthesize(makeRequest());

    const input = (ConverseCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(input.messages).toHaveLength(1);
    expect(input.messages[0].role).toBe('user');
  });

  it('sets temperature to 0 for deterministic output', async () => {
    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(JSON.stringify(canned.validResponse)));

    const provider = new BedrockLlmProvider(makeConfig());
    await provider.synthesize(makeRequest());

    const input = (ConverseCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(input.inferenceConfig?.temperature).toBe(0);
  });

  it('returns a SynthesisResult with correct structure', async () => {
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(JSON.stringify(canned.validResponse)));

    const provider = new BedrockLlmProvider(makeConfig());
    const result = await provider.synthesize(makeRequest());

    expect(result.crux).toBeTypeOf('string');
    expect(result.resolution).toBeTypeOf('string');
    expect(Array.isArray(result.affectedAreas)).toBe(true);
    expect(result.tokenUsage.input).toBe(512);
    expect(result.tokenUsage.output).toBe(128);
    expect(result.tokenUsage.total).toBe(640);
    expect(result.modelId).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
    expect(result.promptVersion).toBeTruthy();
    expect(typeof result.latencyMs).toBe('number');
  });

  it('parses valid response with prose wrapper', async () => {
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(canned.validResponseWithProse as string));

    const provider = new BedrockLlmProvider(makeConfig());
    const result = await provider.synthesize(makeRequest());
    expect(result.crux.length).toBeGreaterThan(0);
  });

  it('includes abortSignal in SDK send call', async () => {
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(JSON.stringify(canned.validResponse)));

    const provider = new BedrockLlmProvider(makeConfig());
    await provider.synthesize(makeRequest());

    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
  });
});

// ---------------------------------------------------------------------------
// Error handling and classification
// ---------------------------------------------------------------------------

describe('BedrockLlmProvider.synthesize — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies ThrottlingException as RetryableLlmError', async () => {
    const err = Object.assign(new Error('Rate limited'), { name: 'ThrottlingException' });
    mockSend.mockRejectedValueOnce(err);

    const provider = new BedrockLlmProvider(makeConfig());
    await expect(provider.synthesize(makeRequest())).rejects.toBeInstanceOf(RetryableLlmError);
  });

  it('classifies ThrottlingException with THROTTLED code', async () => {
    const err = Object.assign(new Error('Rate limited'), { name: 'ThrottlingException' });
    mockSend.mockRejectedValueOnce(err);

    const provider = new BedrockLlmProvider(makeConfig());
    try {
      await provider.synthesize(makeRequest());
    } catch (e) {
      expect((e as RetryableLlmError).code).toBe('THROTTLED');
    }
  });

  it('classifies ValidationException as NonRetryableLlmError', async () => {
    const err = Object.assign(new Error('Bad input'), { name: 'ValidationException' });
    mockSend.mockRejectedValueOnce(err);

    const provider = new BedrockLlmProvider(makeConfig());
    await expect(provider.synthesize(makeRequest())).rejects.toBeInstanceOf(NonRetryableLlmError);
  });

  it('throws InvalidModelOutputError for malformed JSON response', async () => {
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(canned.malformedResponse as string));

    const provider = new BedrockLlmProvider(makeConfig());
    await expect(provider.synthesize(makeRequest())).rejects.toBeInstanceOf(NonRetryableLlmError);
  });

  it('throws InvalidModelOutputError for wrong schema response', async () => {
    const canned = loadCanned();
    mockSend.mockResolvedValueOnce(makeBedrockResponse(JSON.stringify(canned.wrongSchemaResponse)));

    const provider = new BedrockLlmProvider(makeConfig());
    await expect(provider.synthesize(makeRequest())).rejects.toBeInstanceOf(NonRetryableLlmError);
  });

  it('classifies ServiceUnavailableException as SERVICE_UNAVAILABLE', async () => {
    const err = Object.assign(new Error('Unavailable'), { name: 'ServiceUnavailableException' });
    mockSend.mockRejectedValueOnce(err);

    const provider = new BedrockLlmProvider(makeConfig());
    try {
      await provider.synthesize(makeRequest());
    } catch (e) {
      expect((e as RetryableLlmError).code).toBe('SERVICE_UNAVAILABLE');
    }
  });
});

// ---------------------------------------------------------------------------
// Timeout enforcement
// ---------------------------------------------------------------------------

describe('BedrockLlmProvider — timeout', () => {
  it('throws RetryableLlmError when send throws AbortError', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    mockSend.mockRejectedValueOnce(abortErr);

    const provider = new BedrockLlmProvider(makeConfig({ defaultTimeoutMs: 100 }));
    await expect(provider.synthesize(makeRequest())).rejects.toBeInstanceOf(RetryableLlmError);
  });

  it('classifies AbortError (from SDK) as NETWORK_ERROR via classifyProviderError', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockSend.mockRejectedValueOnce(abortErr);

    const provider = new BedrockLlmProvider(makeConfig({ defaultTimeoutMs: 100 }));
    try {
      await provider.synthesize(makeRequest());
    } catch (e) {
      expect((e as RetryableLlmError).code).toBe('NETWORK_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// FakeLlmProvider as drop-in
// ---------------------------------------------------------------------------

describe('FakeLlmProvider', () => {
  it('records calls and returns a deterministic result', async () => {
    const { FakeLlmProvider } = await import('../fake.provider.js');
    const fake = new FakeLlmProvider();
    const request = makeRequest();
    const result = await fake.synthesize(request);

    expect(fake.callCount).toBe(1);
    expect(fake.callHistory[0]?.request).toBe(request);
    expect(result.crux).toContain(request.ticketId);
  });

  it('throws configured error', async () => {
    const { FakeLlmProvider } = await import('../fake.provider.js');
    const error = new RetryableLlmError('THROTTLED', 'Rate limit');
    const fake = new FakeLlmProvider({ throwError: error });

    await expect(fake.synthesize(makeRequest())).rejects.toBe(error);
    expect(fake.callCount).toBe(1);
  });

  it('resetCalls clears the history', async () => {
    const { FakeLlmProvider } = await import('../fake.provider.js');
    const fake = new FakeLlmProvider();
    await fake.synthesize(makeRequest());
    expect(fake.callCount).toBe(1);
    fake.resetCalls();
    expect(fake.callCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NoopLlmProvider
// ---------------------------------------------------------------------------

describe('NoopLlmProvider', () => {
  it('always throws NonRetryableLlmError', async () => {
    const { NoopLlmProvider } = await import('../fake.provider.js');
    const noop = new NoopLlmProvider();
    await expect(noop.synthesize(makeRequest())).rejects.toBeInstanceOf(NonRetryableLlmError);
  });
});
