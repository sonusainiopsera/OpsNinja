/**
 * WebhookDispatcher — shared delivery engine for both the API test-fire
 * and the webhook-worker.
 *
 * Security constraints:
 *  - SSRF re-validation runs immediately before every attempt (DNS rebinding).
 *  - 10s connect timeout, 20s read timeout via undici.
 *  - maxRedirections: 0 — redirects refused with REDIRECT_REFUSED.
 *  - Response body capped at 1KB before persistence.
 *  - Decrypted secrets exist only for the duration of one signing call.
 *  - Secrets, full response bodies, and signature values never logged.
 */

import { request as undiciRequest, errors as undiciErrors } from 'undici';
import { buildSignatureHeader } from './signature';
import { canonicalStringify } from './canonical-payload';
import type { CanonicalEvent } from './canonical-payload';
import { validateWebhookUrl } from './ssrf-validator';

export const MAX_RESPONSE_SNIPPET_BYTES = 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 20_000;

export type DispatchOutcome =
  | 'delivered'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'dropped'
  | 'blocked';

export interface DispatchResult {
  outcome: DispatchOutcome;
  httpStatus: number;
  latencyMs: number;
  responseSnippet: string;
  errorCode?: string;
}

export interface DispatchInput {
  url: string;
  /** Plaintext current signing secret — exists in memory for duration of call only. */
  plaintextSecret: string;
  /** Previous plaintext secret during rotation grace window. */
  previousPlaintextSecret?: string;
  event: CanonicalEvent;
  /** Unix timestamp for signature (injectable for tests). */
  unixTimestamp?: number;
}

/**
 * Dispatch a signed event payload to a webhook endpoint.
 *
 * Canonical serialisation: deterministic stable-key JSON signed and transmitted
 * without re-serialisation — the signed bytes equal the transmitted bytes.
 */
export async function dispatchWebhook(input: DispatchInput): Promise<DispatchResult> {
  const { url, plaintextSecret, previousPlaintextSecret, event } = input;
  const unixTimestamp = input.unixTimestamp ?? Math.floor(Date.now() / 1000);

  // ── SSRF re-validation (DNS rebinding defence) ───────────────────────────
  const validation = await validateWebhookUrl(url);
  if (!validation.allowed) {
    return {
      outcome: 'blocked',
      httpStatus: 0,
      latencyMs: 0,
      responseSnippet: '',
      errorCode: 'SSRF_BLOCKED',
    };
  }

  // ── Canonical serialisation + signing ───────────────────────────────────
  const rawBody = canonicalStringify(event);

  const signatureHeader = buildSignatureHeader({
    rawBody,
    unixTimestamp,
    secret: plaintextSecret,
    previousSecret: previousPlaintextSecret,
  });

  // ── HTTP POST with undici (explicit timeouts, no redirects) ─────────────
  const start = Date.now();
  try {
    const response = await undiciRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpsNinja-Event-Id': event.id,
        'X-OpsNinja-Event-Type': event.type,
        'X-OpsNinja-Timestamp': String(unixTimestamp),
        'X-OpsNinja-Signature': signatureHeader,
        'User-Agent': 'OpsNinja-Webhook/1.0',
      },
      body: rawBody,
      headersTimeout: CONNECT_TIMEOUT_MS,
      bodyTimeout: READ_TIMEOUT_MS,
      maxRedirections: 0,
      throwOnError: false,
    });

    const latencyMs = Date.now() - start;

    // Read and cap response body at 1KB.
    let snippetBytes = Buffer.alloc(0);
    for await (const chunk of response.body) {
      const combined = Buffer.concat([snippetBytes, chunk as Buffer]);
      if (combined.length >= MAX_RESPONSE_SNIPPET_BYTES) {
        snippetBytes = combined.slice(0, MAX_RESPONSE_SNIPPET_BYTES);
        response.body.destroy();
        break;
      }
      snippetBytes = combined;
    }

    const responseSnippet = snippetBytes.toString('utf8');
    const httpStatus = response.statusCode;

    const outcome = classifyHttpOutcome(httpStatus);
    return { outcome, httpStatus, latencyMs, responseSnippet };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return classifyNetworkError(err, latencyMs);
  }
}

function classifyHttpOutcome(httpStatus: number): DispatchOutcome {
  if (httpStatus >= 200 && httpStatus < 300) return 'delivered';
  if (httpStatus === 408 || httpStatus === 429) return 'failed_retryable';
  if (httpStatus >= 500) return 'failed_retryable';
  return 'failed_permanent';
}

function classifyNetworkError(err: unknown, latencyMs: number): DispatchResult {
  const error = err as Error & { code?: string };

  if (
    error instanceof undiciErrors.HeadersTimeoutError ||
    error instanceof undiciErrors.BodyTimeoutError ||
    error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    error.name === 'ConnectTimeoutError'
  ) {
    return {
      outcome: 'failed_retryable',
      httpStatus: 0,
      latencyMs,
      responseSnippet: '',
      errorCode: 'WEBHOOK_TIMEOUT',
    };
  }

  if (
    error instanceof undiciErrors.UndiciError &&
    (error.message.includes('redirect') || error.name === 'NotAllowedError')
  ) {
    return {
      outcome: 'failed_permanent',
      httpStatus: 0,
      latencyMs,
      responseSnippet: '',
      errorCode: 'REDIRECT_REFUSED',
    };
  }

  return {
    outcome: 'failed_retryable',
    httpStatus: 0,
    latencyMs,
    responseSnippet: '',
    errorCode: 'WEBHOOK_DISPATCH_ERROR',
  };
}
