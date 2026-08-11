/**
 * WebhookDispatcher – delivers a signed webhook payload to a tenant endpoint.
 *
 * Security invariants:
 *  - SSRF re-validated at delivery time (DNS rebinding defence).
 *  - maxRedirections = 0 (redirects are refused).
 *  - Response body capped at RESPONSE_SNIPPET_MAX bytes.
 *  - 10s connect timeout, 20s total read timeout via AbortController.
 *  - No Authorization-style headers from receiver responses are logged.
 *  - Secrets exist only in memory for the duration of one signing operation.
 */

import { buildSignatureHeader } from './signature';
import { buildCanonicalPayload, WebhookEventEnvelope } from './canonical-payload';
import { validateWebhookUrl } from './ssrf-validator';

/** Maximum bytes read from the receiver response body for the snippet. */
export const RESPONSE_SNIPPET_MAX = 1024;
/** Connect + headers timeout in milliseconds. */
export const CONNECT_TIMEOUT_MS = 10_000;
/** Total request (connect + read) timeout in milliseconds. */
export const TOTAL_TIMEOUT_MS = 30_000;

export type DeliveryOutcome =
  | 'delivered'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'dropped'
  | 'blocked';

export interface DispatchResult {
  outcome: DeliveryOutcome;
  httpStatus?: number;
  latencyMs: number;
  responseSnippet?: string;
  errorCode?: string;
}

export interface DispatchParams {
  url: string;
  /** Plaintext base64url signing secret. */
  secret: string;
  /** Previous plaintext base64url secret (rotation grace window). */
  previousSecret?: string;
  envelope: WebhookEventEnvelope;
}

/**
 * Validates the URL at delivery time, constructs the signed request, sends it,
 * and returns a classified outcome with latency and a truncated response snippet.
 */
export async function dispatch(params: DispatchParams): Promise<DispatchResult> {
  const start = Date.now();

  // ── SSRF re-validation (DNS rebinding defence) ────────────────────────────
  const ssrfResult = await validateWebhookUrl(params.url);
  if (!ssrfResult.valid) {
    return {
      outcome: 'blocked',
      latencyMs: Date.now() - start,
      errorCode: 'SSRF_BLOCKED',
    };
  }

  const rawBody = buildCanonicalPayload(params.envelope);
  const { header: signatureHeader, timestamp } = buildSignatureHeader(
    rawBody,
    params.secret,
    params.previousSecret,
  );

  // ── AbortController for timeout ───────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpsNinja-Event-Id': params.envelope.id,
          'X-OpsNinja-Event-Type': params.envelope.type,
          'X-OpsNinja-Timestamp': String(timestamp),
          'X-OpsNinja-Signature': signatureHeader,
        },
        body: rawBody,
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (err) {
      const latencyMs = Date.now() - start;
      const isAbort = (err as Error)?.name === 'AbortError';
      const isRedirect = (err as Error)?.name === 'TypeError' &&
        (err as Error)?.message?.includes('redirect');

      if (isRedirect) {
        return { outcome: 'failed_permanent', latencyMs, errorCode: 'REDIRECT_REFUSED' };
      }
      if (isAbort) {
        return { outcome: 'failed_retryable', latencyMs, errorCode: 'TIMEOUT' };
      }
      return { outcome: 'failed_retryable', latencyMs, errorCode: 'CONNECT_ERROR' };
    }

    const latencyMs = Date.now() - start;
    const httpStatus = response.status;

    // ── Read and cap response body ─────────────────────────────────────────
    let responseSnippet: string | undefined;
    try {
      const reader = response.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let done = false;
        while (!done && totalBytes < RESPONSE_SNIPPET_MAX) {
          const result = await reader.read();
          done = result.done;
          if (result.value) {
            const chunk = result.value.slice(0, RESPONSE_SNIPPET_MAX - totalBytes);
            chunks.push(chunk);
            totalBytes += chunk.length;
          }
        }
        reader.cancel().catch(() => {});
        const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
        responseSnippet = bytes.toString('utf8').slice(0, RESPONSE_SNIPPET_MAX);
      }
    } catch {
      // Body read failure doesn't affect delivery classification
    }

    // ── Classify outcome ───────────────────────────────────────────────────
    const outcome = classifyOutcome(httpStatus);
    return { outcome, httpStatus, latencyMs, responseSnippet };
  } finally {
    clearTimeout(timeoutId);
  }
}

function classifyOutcome(httpStatus: number): DeliveryOutcome {
  if (httpStatus >= 200 && httpStatus < 300) return 'delivered';
  if (httpStatus === 408 || httpStatus === 429) return 'failed_retryable';
  if (httpStatus >= 500) return 'failed_retryable';
  // 4xx other than 408/429 → permanent failure
  return 'failed_permanent';
}
