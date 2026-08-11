/**
 * WebhookController — POST /webhooks/jira/:tenantSlug
 *
 * This is the sole inbound HTTP handler for Jira webhook deliveries. It is
 * intentionally thin: verify → persist → enqueue. No mapping, no ticket
 * mutation, no outbound calls.
 *
 * Security model:
 *  - No cookie / session / JWT authentication.
 *  - HMAC-SHA-256 signature verification over the raw request body.
 *  - 5-minute replay window enforced on X-OpsNinja-Timestamp.
 *  - Failures return 401 without persisting the body.
 *  - Tenant existence is not disclosed in error responses.
 *  - 1 MB payload size cap enforced via NestJS raw-body limit.
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Headers,
  Req,
  HttpCode,
  BadRequestException,
  UnauthorizedException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { verifyJiraWebhookSignature } from './signature.verifier';
import { IngestService, type JiraWebhookPayload } from './ingest.service';

const MAX_PAYLOAD_BYTES = 1 * 1024 * 1024; // 1 MB

@Controller()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly ingest: IngestService) {}

  // --------------------------------------------------------------------------
  // Webhook endpoint
  // --------------------------------------------------------------------------

  @Post('webhooks/jira/:tenantSlug')
  @HttpCode(200)
  async receiveWebhook(
    @Param('tenantSlug') tenantSlug: string,
    @Headers('x-hub-signature') hubSignatureHeader: string | undefined,
    @Headers('x-opsninja-timestamp') timestampHeader: string | undefined,
    @Req() req: Request,
  ): Promise<{ received: boolean; deduped: boolean }> {
    // ── 1. Raw body ──────────────────────────────────────────────────────────
    const rawBody: Buffer = (req as Request & { rawBody?: Buffer }).rawBody
      ?? Buffer.from(JSON.stringify(req.body));

    // ── 2. Size cap (pre-parse defence; body-parser limit is also set in main.ts) ──
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      this.logger.warn('webhook:oversized', {
        tenantSlug,
        bytes: rawBody.length,
        metric: 'jira_webhook_oversized',
      });
      throw new PayloadTooLargeException({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    }

    // ── 3. Parse JSON early to extract cloudId for secret resolution ─────────
    let parsed: JiraWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as JiraWebhookPayload;
    } catch {
      throw new BadRequestException({ error: { code: 'MALFORMED_PAYLOAD' } });
    }

    // Extract cloudId from matchedWebhookIds context (Jira Cloud) or undefined (DC).
    const cloudId = extractCloudId(parsed);

    // ── 4. Resolve connection & signing secret ───────────────────────────────
    let resolved: Awaited<ReturnType<IngestService['resolveConnection']>>;
    try {
      resolved = await this.ingest.resolveConnection(tenantSlug, cloudId);
    } catch {
      throw new ServiceUnavailableException({ error: { code: 'INGEST_UNAVAILABLE' } });
    }

    if (!resolved) {
      // Return 401 — do NOT disclose whether the tenant exists.
      this.logger.warn('webhook:unresolvable', { tenantSlug, metric: 'jira_webhook_signature_failures' });
      throw new UnauthorizedException({ error: { code: 'INVALID_SIGNATURE' } });
    }

    // ── 5. Signature verification ────────────────────────────────────────────
    const verifyResult = verifyJiraWebhookSignature({
      rawBody,
      hubSignatureHeader,
      timestampHeader,
      secret: resolved.secret,
      previousSecret: resolved.previousSecret,
    });

    if (!verifyResult.valid) {
      this.logger.warn('webhook:sig_fail', {
        tenantSlug,
        reason: verifyResult.reason,
        metric: 'jira_webhook_signature_failures',
      });
      const code = verifyResult.reason === 'stale_signature' ? 'STALE_SIGNATURE' : 'INVALID_SIGNATURE';
      throw new UnauthorizedException({ error: { code } });
    }

    // ── 6. Ingest (persist + enqueue) ─────────────────────────────────────────
    let result: Awaited<ReturnType<IngestService['ingest']>>;
    try {
      result = await this.ingest.ingest(resolved.tenantId, resolved.connectionId, parsed);
    } catch (err) {
      this.logger.error('webhook:ingest_error', { tenantSlug, error: (err as Error).message });
      // Return 503 so Jira retries rather than dropping the event.
      throw new ServiceUnavailableException({ error: { code: 'INGEST_UNAVAILABLE' } });
    }

    return { received: true, deduped: result.deduped };
  }

  // --------------------------------------------------------------------------
  // Health / readiness probes
  // --------------------------------------------------------------------------

  @Get('healthz')
  @HttpCode(200)
  healthz(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readyz')
  @HttpCode(200)
  readyz(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to extract the Jira Cloud site ID from the webhook payload.
 * Jira includes it in some payload shapes; absent for Data Center.
 */
function extractCloudId(payload: JiraWebhookPayload): string | undefined {
  // Some Jira Cloud webhooks embed the cloudId at the top level or within
  // the issue fields. We check common locations.
  const p = payload as Record<string, unknown>;
  if (typeof p['cloudId'] === 'string') return p['cloudId'] as string;
  if (typeof (p['issue'] as Record<string, unknown> | undefined)?.['cloudId'] === 'string') {
    return (p['issue'] as Record<string, unknown>)['cloudId'] as string;
  }
  return undefined;
}
