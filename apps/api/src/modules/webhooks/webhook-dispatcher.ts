/**
 * WebhookDispatcher — sends a signed HTTP POST to a webhook endpoint.
 *
 * Used by both:
 *  - The test-fire action (synchronous, 10-second timeout)
 *  - The delivery worker (WOREF-084)
 *
 * SSRF re-validation occurs immediately before every dispatch attempt.
 * Resolved IP addresses are NEVER returned to callers in API responses.
 *
 * Signing: HMAC-SHA-256 of the raw body using the plaintext signing secret.
 * Header: X-OpsNinja-Signature: sha256=<hex>
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { validateWebhookUrl } from './webhook-url-validator';
import type { TestFireResponse } from './dto/webhook-endpoint.dto';

const TEST_FIRE_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SNIPPET_BYTES = 512;

export interface DispatchResult {
  httpStatus: number;
  latencyMs: number;
  responseSnippet: string;
  ssrfBlocked?: boolean;
  errorCode?: string;
}

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  /** Dispatch a signed event payload to a webhook endpoint URL. */
  async dispatch(
    url: string,
    plaintextSecret: string,
    eventType: string,
    payload: Record<string, unknown>,
    timeoutMs = TEST_FIRE_TIMEOUT_MS,
  ): Promise<DispatchResult> {
    // ── SSRF re-validation ────────────────────────────────────────────────────
    const validation = await validateWebhookUrl(url);
    if (!validation.allowed) {
      this.logger.warn('SSRF guard blocked dispatch', {
        errorCode: validation.errorCode,
        eventType,
      });
      return {
        httpStatus: 0,
        latencyMs: 0,
        responseSnippet: '',
        ssrfBlocked: true,
        errorCode: validation.errorCode,
      };
    }

    // ── Build and sign payload ────────────────────────────────────────────────
    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    const signature = createHmac('sha256', plaintextSecret)
      .update(body, 'utf8')
      .digest('hex');

    // ── HTTP POST with timeout ────────────────────────────────────────────────
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpsNinja-Signature': `sha256=${signature}`,
          'X-OpsNinja-Event': eventType,
          'User-Agent': 'OpsNinja-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      const latencyMs = Date.now() - start;
      const rawText = await res.text().catch(() => '');
      const responseSnippet = rawText.slice(0, MAX_RESPONSE_SNIPPET_BYTES);

      return { httpStatus: res.status, latencyMs, responseSnippet };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const isTimeout = (err as Error).name === 'AbortError';
      return {
        httpStatus: 0,
        latencyMs,
        responseSnippet: '',
        errorCode: isTimeout ? 'WEBHOOK_TIMEOUT' : 'WEBHOOK_DISPATCH_ERROR',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Send a synthetic ping via test-fire. Returns a TestFireResponse for the API. */
  async testFire(
    url: string,
    plaintextSecret: string,
  ): Promise<TestFireResponse> {
    const result = await this.dispatch(url, plaintextSecret, 'webhook.ping', {
      event: 'webhook.ping',
      timestamp: new Date().toISOString(),
    });

    if (result.ssrfBlocked) {
      return {
        httpStatus: 0,
        latencyMs: 0,
        responseSnippet: `SSRF guard blocked: ${result.errorCode ?? 'unknown'}`,
      };
    }

    return {
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      responseSnippet: result.responseSnippet,
    };
  }
}
