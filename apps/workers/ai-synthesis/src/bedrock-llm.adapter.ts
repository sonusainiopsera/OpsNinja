/**
 * BedrockLlmAdapter — AWS Bedrock implementation of LlmProviderPort.
 *
 * Uses Claude via InvokeModel. The prompt is structured as a system message
 * with the full ticket thread, followed by a user message requesting JSON output.
 *
 * Prompt version: v1.0.0
 * Model: configurable via BEDROCK_MODEL_ID (default: anthropic.claude-3-sonnet-20240229-v1:0)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  RetryableLlmError,
  NonRetryableLlmError,
  type LlmProviderPort,
  type SynthesisRequest,
  type SynthesisResult,
  type AffectedArea,
} from './llm-provider.port';

const PROMPT_VERSION = 'v1.0.0';
const DEFAULT_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';
const INFERENCE_TIMEOUT_MS = 30_000;

@Injectable()
export class BedrockLlmAdapter implements LlmProviderPort {
  private readonly logger = new Logger(BedrockLlmAdapter.name);
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor() {
    this.client = new BedrockRuntimeClient({
      region: process.env['AWS_REGION'] ?? 'us-east-1',
    });
    this.modelId = process.env['BEDROCK_MODEL_ID'] ?? DEFAULT_MODEL_ID;
  }

  async synthesise(request: SynthesisRequest): Promise<SynthesisResult> {
    const prompt = this.buildPrompt(request);
    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      system: 'You are an expert support analyst. Respond with valid JSON only, no markdown.',
      messages: [{ role: 'user', content: prompt }],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    let responseBytes: Uint8Array;
    try {
      const cmd = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
      });
      const response = await this.client.send(cmd, { abortSignal: controller.signal });
      responseBytes = response.body ?? new Uint8Array();
    } catch (err: unknown) {
      clearTimeout(timeout);
      const name = (err as Error).name ?? '';
      if (name === 'AbortError' || name === 'TimeoutError') {
        throw new RetryableLlmError('Bedrock inference timed out');
      }
      // Throttling → retryable
      if (name === 'ThrottlingException' || name === 'ServiceUnavailableException') {
        throw new RetryableLlmError(`Bedrock transient error: ${name}`);
      }
      // Validation → permanent
      throw new NonRetryableLlmError(
        `Bedrock non-retryable error: ${name}`,
        `BEDROCK_${name.toUpperCase()}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const raw = new TextDecoder().decode(responseBytes);
    return this.parseResponse(raw, request);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private buildPrompt(req: SynthesisRequest): string {
    const thread = req.messages
      .map((m) => `[${m.role.toUpperCase()} | ${m.visibility}] ${m.createdAt}\n${m.body}`)
      .join('\n\n---\n\n');

    return [
      `Ticket: ${req.subject}`,
      `Priority: ${req.priority}`,
      `Organization: ${req.organizationName}`,
      req.description ? `Description: ${req.description}` : '',
      req.truncated ? '[Thread truncated due to length]' : '',
      '',
      '=== THREAD ===',
      thread || '[No comments]',
      '',
      '=== TASK ===',
      'Return a JSON object with these fields:',
      '  cruxSummary: one sentence describing the core problem',
      '  resolutionSummary: 2-3 sentences on what was done and current state',
      '  affectedAreas: array of { areaLabel: string, confidence: string (0-1) }',
      '',
      'Example: {"cruxSummary":"...","resolutionSummary":"...","affectedAreas":[{"areaLabel":"billing","confidence":"0.95"}]}',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private parseResponse(raw: string, req: SynthesisRequest): SynthesisResult {
    interface BedrockResponse {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }
    let outer: BedrockResponse;
    try {
      outer = JSON.parse(raw) as BedrockResponse;
    } catch {
      throw new NonRetryableLlmError('Bedrock returned non-JSON response', 'BEDROCK_PARSE_ERROR');
    }

    const text = outer.content?.[0]?.text ?? '';
    let parsed: { cruxSummary?: string; resolutionSummary?: string; affectedAreas?: AffectedArea[] };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new NonRetryableLlmError(
        'Model output was not valid JSON',
        'BEDROCK_OUTPUT_PARSE_ERROR',
      );
    }

    if (!parsed.cruxSummary || !parsed.resolutionSummary) {
      throw new NonRetryableLlmError(
        'Model output missing required fields',
        'BEDROCK_MISSING_FIELDS',
      );
    }

    return {
      cruxSummary: parsed.cruxSummary,
      resolutionSummary: parsed.resolutionSummary,
      affectedAreas: parsed.affectedAreas ?? [],
      modelId: this.modelId,
      promptVersion: PROMPT_VERSION,
      promptTokens: outer.usage?.input_tokens ?? 0,
      completionTokens: outer.usage?.output_tokens ?? 0,
      generatedAt: new Date(),
    };
  }
}
