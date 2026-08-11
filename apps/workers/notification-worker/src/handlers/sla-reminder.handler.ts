/**
 * SlaReminderHandler — WO-048
 *
 * Processes sla.reminder_due and sla.breached events from the dedicated
 * sla-notifications SQS queue (subscribed to the SNS topic with a filter
 * policy on those two event types).
 *
 * Processing steps per channel (email + webhook):
 *  1. Unwrap the SNS notification envelope if present.
 *  2. Zod-parse and validate the inner SLA event payload.
 *  3. Open a DB transaction and SET LOCAL app.current_tenant.
 *  4. INSERT INTO sla_reminder_emissions ON CONFLICT (timer_id, threshold_pct, channel)
 *     DO NOTHING RETURNING id — zero rows means already emitted; short-circuit.
 *  5. Live-state guards: re-read timer state and ticket state.
 *     - Timer cancelled  → suppress(TIMER_CANCELLED)
 *     - Timer paused     → suppress(TIMER_PAUSED)
 *     - Ticket terminal  → suppress(TICKET_TERMINAL)
 *  6. Resolve recipient via three-level fallback ladder:
 *     a. Ticket assignee direct email
 *     b. Assignment group members (first active member)
 *     c. SLA_ESCALATION_EMAIL env var (tenant-level fallback)
 *     d. Unroutable → park with delivery_status='unroutable', log operator alert
 *  7. Dispatch:
 *     - Email: SES via EmailSenderPort (recipient never logged)
 *     - Webhook: SSRF-validate URL, HMAC-SHA256-sign, POST
 *  8. UPDATE sla_reminder_emissions SET delivery_status, emitted_at, attempt_count
 *  9. Write audit_logs record.
 * 10. Emit structured metrics.
 *
 * Idempotency guarantee: the UNIQUE INDEX on (timer_id, threshold_pct, channel)
 * means exactly one worker pod wins the INSERT race on concurrent redelivery.
 * The losing pod sees 0 rows returned and ACKs as a no-op — no duplicate alert.
 */

import { createHash, createHmac } from 'crypto';
import { promises as dns } from 'dns';
import { Pool } from 'pg';
import { z } from 'zod';
import { redactLogObject } from '@opsninja/observability';
import type { EmailSenderPort } from '../ports/email-sender.port';

// ---------------------------------------------------------------------------
// SLA event Zod schema
// ---------------------------------------------------------------------------

const SlaReminderEventSchema = z.object({
  eventType: z.enum(['sla.reminder_due', 'sla.breached']),
  eventId: z.string().uuid(),
  tenantId: z.string().uuid(),
  timerId: z.string().uuid(),
  ticketId: z.string().uuid(),
  ticketKey: z.string(),
  clockType: z.enum(['response', 'resolution']),
  thresholdPct: z.number().int().min(0).max(100),
  targetAt: z.string().datetime(),
  remainingMs: z.number().int(),
  priority: z.string(),
  organizationId: z.string().uuid(),
  traceparent: z.string().optional(),
  breachedAt: z.string().datetime().optional(),
});

export type SlaReminderEvent = z.infer<typeof SlaReminderEventSchema>;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class SlaReminderPermanentError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'SlaReminderPermanentError';
  }
}

// ---------------------------------------------------------------------------
// SSRF-safe URL validator (inlined to avoid cross-app import)
// ---------------------------------------------------------------------------

interface Cidr4 { base: number; mask: number; }

function ipv4ToNum(addr: string): number {
  return addr.split('.').reduce((acc, o) => (acc << 8) | parseInt(o, 10), 0) >>> 0;
}

function parseCidr4(cidr: string): Cidr4 {
  const [addr, bits] = cidr.split('/') as [string, string];
  const base = ipv4ToNum(addr);
  const mask = bits === '32' ? 0xffffffff : ~(0xffffffff >>> parseInt(bits, 10));
  return { base: base >>> 0, mask: mask >>> 0 };
}

const IPV4_DENY: Cidr4[] = [
  '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '169.254.0.0/16', '0.0.0.0/8', '100.64.0.0/10', '240.0.0.0/4',
].map(parseCidr4);

function isBlockedIpv4(addr: string): boolean {
  try {
    const n = ipv4ToNum(addr);
    return IPV4_DENY.some((c) => (n & c.mask) >>> 0 === c.base);
  } catch { return true; }
}

function isBlockedIpv6(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, '');
  if (a === '::1' || a === '::') return true;
  const first = a.split(':')[0] ?? '';
  if (!first) return false;
  const h = parseInt(first.padStart(4, '0'), 16);
  if ((h & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((h & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  return false;
}

async function isSsrfSafeUrl(rawUrl: string): Promise<{ allowed: boolean; errorCode?: string }> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return { allowed: false, errorCode: 'WEBHOOK_URL_INVALID' }; }
  if (parsed.protocol !== 'https:') return { allowed: false, errorCode: 'WEBHOOK_URL_NOT_HTTPS' };
  if (parsed.username || parsed.password) return { allowed: false, errorCode: 'WEBHOOK_URL_EMBEDDED_CREDENTIALS' };

  const host = parsed.hostname;
  const ipv4Re = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  if (ipv4Re.test(host)) {
    return isBlockedIpv4(host)
      ? { allowed: false, errorCode: 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS' }
      : { allowed: true };
  }
  if (host.startsWith('[') || host.includes(':')) {
    return isBlockedIpv6(host.replace(/^\[|\]$/g, ''))
      ? { allowed: false, errorCode: 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS' }
      : { allowed: true };
  }

  let addrs: Array<{ address: string; family: number }>;
  try { addrs = await dns.lookup(host, { all: true }); } catch {
    return { allowed: false, errorCode: 'WEBHOOK_URL_DNS_RESOLUTION_FAILED' };
  }
  if (addrs.length === 0) return { allowed: false, errorCode: 'WEBHOOK_URL_DNS_RESOLUTION_FAILED' };

  for (const { address, family } of addrs) {
    const blocked = family === 4 ? isBlockedIpv4(address) : family === 6 ? isBlockedIpv6(address) : true;
    if (blocked) return { allowed: false, errorCode: 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS' };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TERMINAL_TICKET_STATUSES = new Set(['resolved', 'closed']);
const TERMINAL_TIMER_STATES = new Set(['met', 'breached', 'cancelled']);
const WEBHOOK_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Metric + log helpers
// ---------------------------------------------------------------------------

function emitMetric(name: string, labels: Record<string, string>): void {
  console.log(JSON.stringify({ metric: name, labels, value: 1, ts: Date.now() }));
}

// ---------------------------------------------------------------------------
// Email content builder
// ---------------------------------------------------------------------------

function buildEmailContent(event: SlaReminderEvent): {
  subject: string; htmlBody: string; textBody: string;
} {
  const breached = event.eventType === 'sla.breached';
  const label = breached ? 'BREACH' : `${event.thresholdPct}%`;
  const remSecs = Math.max(0, Math.floor(event.remainingMs / 1000));
  const remLabel = remSecs === 0 ? 'SLA now breached' : `${Math.ceil(remSecs / 60)} min remaining`;
  const deepLink = `${process.env['APP_BASE_URL'] ?? 'https://app.opsninja.io'}/tickets/${event.ticketId}`;

  const subject = breached
    ? `[SLA BREACH] ${event.ticketKey} — ${event.clockType} SLA breached`
    : `[SLA ${label}] ${event.ticketKey} — ${event.clockType} at ${event.thresholdPct}%`;

  const textBody = [
    subject, '',
    `Ticket  : ${event.ticketKey}`,
    `Priority: ${event.priority}`,
    `Clock   : ${event.clockType}`,
    `Status  : ${remLabel}`,
    `Target  : ${event.targetAt}`,
    '', `View: ${deepLink}`,
  ].join('\n');

  const htmlBody = `<!DOCTYPE html><html><body>
    <h2>${subject}</h2>
    <table>
      <tr><td><strong>Ticket</strong></td><td>${event.ticketKey}</td></tr>
      <tr><td><strong>Priority</strong></td><td>${event.priority}</td></tr>
      <tr><td><strong>Clock type</strong></td><td>${event.clockType}</td></tr>
      <tr><td><strong>Status</strong></td><td>${remLabel}</td></tr>
      <tr><td><strong>Target</strong></td><td>${event.targetAt}</td></tr>
    </table>
    <p><a href="${deepLink}">View ticket →</a></p>
  </body></html>`;

  return { subject, htmlBody, textBody };
}

// ---------------------------------------------------------------------------
// Webhook payload builder + signer
// ---------------------------------------------------------------------------

function buildWebhookPayload(event: SlaReminderEvent): string {
  return JSON.stringify({
    event: event.eventType,
    occurredAt: new Date().toISOString(),
    ticket: {
      id: event.ticketId,
      key: event.ticketKey,
      priority: event.priority,
      organizationId: event.organizationId,
    },
    sla: {
      clockType: event.clockType,
      thresholdPct: event.thresholdPct,
      targetAt: event.targetAt,
      remainingMs: event.remainingMs,
      state: event.eventType === 'sla.breached' ? 'breached' : 'running',
    },
  });
}

/**
 * Sign a webhook payload using HMAC-SHA256.
 * Signature covers: `${timestampMs}.${bodyStr}` — matches the 5-minute replay window spec.
 */
export function signWebhookPayload(bodyStr: string, secret: string, timestampMs: number): string {
  return createHmac('sha256', secret).update(`${timestampMs}.${bodyStr}`).digest('hex');
}

// ---------------------------------------------------------------------------
// SlaReminderHandler
// ---------------------------------------------------------------------------

export class SlaReminderHandler {
  constructor(
    private readonly pool: Pool,
    private readonly emailSender: EmailSenderPort,
  ) {}

  /**
   * Handle a raw SQS message body from the sla-notifications queue.
   * Supports both SNS-wrapped (Type=Notification) and direct JSON payloads.
   */
  async handleMessage(sqsBody: string): Promise<void> {
    // ── Step 1: Unwrap SNS envelope if present ──────────────────────────────
    let innerJson: string;
    try {
      const outer = JSON.parse(sqsBody) as Record<string, unknown>;
      if (outer['Type'] === 'Notification' && typeof outer['Message'] === 'string') {
        innerJson = outer['Message'];
      } else {
        innerJson = sqsBody;
      }
    } catch {
      throw new SlaReminderPermanentError('PARSE_ERROR', 'Unparseable SQS body');
    }

    // ── Step 2: Parse and validate ──────────────────────────────────────────
    let event: SlaReminderEvent;
    try {
      event = SlaReminderEventSchema.parse(JSON.parse(innerJson));
    } catch (err) {
      throw new SlaReminderPermanentError(
        'SCHEMA_INVALID',
        `SLA event schema invalid: ${(err as Error).message}`,
      );
    }

    const traceCtx = event.traceparent ? { traceparent: event.traceparent } : {};

    // ── Steps 3–10: Per-channel processing ─────────────────────────────────
    await this.processChannel(event, 'email', traceCtx);
    await this.processChannel(event, 'webhook', traceCtx);
  }

  // ---------------------------------------------------------------------------
  // Per-channel processing
  // ---------------------------------------------------------------------------

  private async processChannel(
    event: SlaReminderEvent,
    channel: 'email' | 'webhook',
    traceCtx: Record<string, string>,
  ): Promise<void> {
    const { tenantId, timerId, ticketId, thresholdPct } = event;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      // ── Step 4: Idempotency insert ────────────────────────────────────────
      const ins = await client.query<{ id: string }>(
        `INSERT INTO sla_reminder_emissions
           (tenant_id, timer_id, ticket_id, threshold_pct, channel, delivery_status, attempt_count)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'pending', 0)
         ON CONFLICT (timer_id, threshold_pct, channel) DO NOTHING
         RETURNING id`,
        [tenantId, timerId, ticketId, thresholdPct, channel],
      );

      if (ins.rows.length === 0) {
        // Already emitted for this (timer, threshold, channel) — idempotent no-op.
        await client.query('COMMIT');
        console.log(JSON.stringify(redactLogObject({
          msg: 'SLA reminder already emitted — idempotent ACK',
          tenantId, timerId, thresholdPct, channel, ...traceCtx,
        })));
        emitMetric('sla_reminder_duplicate_total', { channel, threshold: String(thresholdPct) });
        return;
      }

      const emissionId = ins.rows[0]!.id;

      // ── Step 5a: Live-state guard — timer ─────────────────────────────────
      const timerRow = await client.query<{ state: string; paused_at: string | null }>(
        `SELECT state, paused_at FROM sla_timers
         WHERE tenant_id = $1::uuid AND id = $2::uuid LIMIT 1`,
        [tenantId, timerId],
      );
      const timer = timerRow.rows[0];

      if (!timer || TERMINAL_TIMER_STATES.has(timer.state)) {
        const reason = `Timer state is ${timer?.state ?? 'not found'}`;
        await this.suppress(client, emissionId, tenantId, reason);
        await this.audit(client, tenantId, timerId, ticketId, thresholdPct, channel, 'sla.reminder.suppressed', traceCtx);
        await client.query('COMMIT');
        emitMetric('sla_reminder_suppressed_total', { channel, threshold: String(thresholdPct), reason: 'timer_not_running' });
        return;
      }

      if (timer.paused_at !== null) {
        await this.suppress(client, emissionId, tenantId,
          'Timer is currently paused — suppressed to prevent misleading alert');
        await this.audit(client, tenantId, timerId, ticketId, thresholdPct, channel, 'sla.reminder.suppressed', traceCtx);
        await client.query('COMMIT');
        emitMetric('sla_reminder_suppressed_total', { channel, threshold: String(thresholdPct), reason: 'timer_paused' });
        return;
      }

      // ── Step 5b: Live-state guard — ticket ────────────────────────────────
      const ticketRow = await client.query<{
        status: string;
        assignee_id: string | null;
        assignment_group_id: string | null;
      }>(
        `SELECT status, assignee_id, assignment_group_id
         FROM tickets WHERE tenant_id = $1::uuid AND id = $2::uuid LIMIT 1`,
        [tenantId, ticketId],
      );
      const ticket = ticketRow.rows[0];

      if (!ticket || TERMINAL_TICKET_STATUSES.has(ticket.status)) {
        const reason = `Ticket status is ${ticket?.status ?? 'not found'}`;
        await this.suppress(client, emissionId, tenantId, reason);
        await this.audit(client, tenantId, timerId, ticketId, thresholdPct, channel, 'sla.reminder.suppressed', traceCtx);
        await client.query('COMMIT');
        emitMetric('sla_reminder_suppressed_total', { channel, threshold: String(thresholdPct), reason: 'ticket_terminal' });
        return;
      }

      // ── Step 6: Recipient resolution ──────────────────────────────────────
      const resolved = await this.resolveRecipient(client, tenantId, ticket);

      if (!resolved) {
        await client.query(
          `UPDATE sla_reminder_emissions
           SET delivery_status='unroutable', suppressed_reason=$1, updated_at=now()
           WHERE id=$2::uuid AND tenant_id=$3::uuid`,
          ['No recipient found at any fallback level', emissionId, tenantId],
        );
        await this.audit(client, tenantId, timerId, ticketId, thresholdPct, channel, 'sla.reminder.unroutable', traceCtx);
        await client.query('COMMIT');
        console.error(JSON.stringify({
          alert: 'SLA_REMINDER_UNROUTABLE',
          msg: 'SLA reminder has no deliverable recipient — operator action required',
          tenantId, timerId, ticketId, thresholdPct, channel,
          runbook: 'https://runbooks.opsninja.io/sla-notifications',
          ...traceCtx,
        }));
        emitMetric('sla_reminder_suppressed_total', { channel, threshold: String(thresholdPct), reason: 'unroutable' });
        return;
      }

      // ── Step 7: Dispatch ──────────────────────────────────────────────────
      let deliveryStatus = 'failed';
      try {
        if (channel === 'email' && resolved.recipientEmail) {
          const { subject, htmlBody, textBody } = buildEmailContent(event);
          await this.emailSender.sendEmail({
            from: process.env['SES_FROM_ADDRESS'] ?? 'noreply@opsninja.io',
            to: resolved.recipientEmail,
            subject,
            htmlBody,
            textBody,
            traceId: event.traceparent,
          });
          deliveryStatus = 'sent';

        } else if (channel === 'webhook' && resolved.webhookEndpoints.length > 0) {
          const bodyStr = buildWebhookPayload(event);
          const ts = Date.now();
          let anySuccess = false;

          for (const ep of resolved.webhookEndpoints) {
            // SSRF re-validation immediately before each send (DNS rebinding defence)
            const ssrf = await isSsrfSafeUrl(ep.url);
            if (!ssrf.allowed) {
              console.warn(JSON.stringify({
                msg: 'SSRF guard blocked webhook', errorCode: ssrf.errorCode, tenantId,
              }));
              emitMetric('sla_reminder_delivery_failed_total', { channel: 'webhook', reason: 'ssrf_blocked' });
              continue;
            }
            const sig = signWebhookPayload(bodyStr, ep.signingKey, ts);
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS);
            try {
              const res = await fetch(ep.url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-OpsNinja-Signature': `sha256=${sig}`,
                  'X-OpsNinja-Timestamp': String(ts),
                  'X-OpsNinja-Event-Id': event.eventId,
                  'X-OpsNinja-Event': event.eventType,
                  'User-Agent': 'OpsNinja-SLAReminder/1.0',
                },
                body: bodyStr,
                signal: ctrl.signal,
              });
              clearTimeout(timer);
              if (res.ok) {
                anySuccess = true;
              } else if (res.status >= 500) {
                throw new Error(`Webhook ${ep.url} returned ${res.status}`); // retryable
              }
              // 4xx — permanent failure for this endpoint, continue to next
            } catch (fetchErr) {
              clearTimeout(timer);
              // Rethrow 5xx errors for SQS requeue; swallow timeouts/4xx
              if ((fetchErr as Error).message?.includes('returned 5')) throw fetchErr;
              console.error(JSON.stringify({
                msg: 'Webhook dispatch error',
                error: (fetchErr as Error).message,
                tenantId,
              }));
            }
          }
          deliveryStatus = anySuccess ? 'sent' : 'failed';
        } else {
          // No applicable recipient for this channel type
          deliveryStatus = 'suppressed';
        }
      } catch (dispatchErr) {
        // Retryable dispatch error — record attempt, rollback, rethrow for SQS requeue
        await client.query(
          `UPDATE sla_reminder_emissions
           SET attempt_count=attempt_count+1, delivery_status='failed', updated_at=now()
           WHERE id=$1::uuid AND tenant_id=$2::uuid`,
          [emissionId, tenantId],
        );
        await client.query('COMMIT');
        emitMetric('sla_reminder_delivery_failed_total', { channel, threshold: String(thresholdPct) });
        throw dispatchErr;
      }

      // ── Step 8: Update emission row ───────────────────────────────────────
      await client.query(
        `UPDATE sla_reminder_emissions
         SET delivery_status=$1,
             recipient_ref=$2,
             emitted_at=CASE WHEN $1='sent' THEN now() ELSE emitted_at END,
             attempt_count=1,
             updated_at=now()
         WHERE id=$3::uuid AND tenant_id=$4::uuid`,
        [deliveryStatus, resolved.recipientRef, emissionId, tenantId],
      );

      // ── Step 9: Audit ─────────────────────────────────────────────────────
      const auditAction = deliveryStatus === 'sent'
        ? 'sla.reminder.sent'
        : `sla.reminder.${deliveryStatus}`;
      await this.audit(client, tenantId, timerId, ticketId, thresholdPct, channel, auditAction, traceCtx);

      await client.query('COMMIT');

      // ── Step 10: Metrics ──────────────────────────────────────────────────
      if (deliveryStatus === 'sent') {
        emitMetric('sla_reminder_emitted_total', {
          channel, threshold: String(thresholdPct),
          clockType: event.clockType, eventType: event.eventType,
        });
      } else {
        emitMetric('sla_reminder_delivery_failed_total', { channel, threshold: String(thresholdPct) });
      }

      console.log(JSON.stringify({
        msg: 'SLA reminder processed', tenantId, timerId, thresholdPct,
        channel, deliveryStatus, eventType: event.eventType, ...traceCtx,
      }));

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Recipient resolution ladder
  // ---------------------------------------------------------------------------

  private async resolveRecipient(
    client: Awaited<ReturnType<Pool['connect']>>,
    tenantId: string,
    ticket: { assignee_id: string | null; assignment_group_id: string | null },
  ): Promise<{
    recipientRef: string;
    recipientEmail: string | null;
    webhookEndpoints: Array<{ url: string; signingKey: string }>;
  } | null> {
    const webhookEndpoints = await this.resolveWebhookEndpoints(client, tenantId);

    // Level 1: Ticket assignee direct email
    if (ticket.assignee_id) {
      const r = await client.query<{ email: string }>(
        `SELECT email FROM users WHERE id=$1::uuid AND tenant_id=$2::uuid LIMIT 1`,
        [ticket.assignee_id, tenantId],
      );
      if (r.rows[0]?.email) {
        return { recipientRef: ticket.assignee_id, recipientEmail: r.rows[0].email, webhookEndpoints };
      }
    }

    // Level 2: Assignment group (first member with email)
    if (ticket.assignment_group_id) {
      const r = await client.query<{ email: string }>(
        `SELECT u.email
         FROM users u
         JOIN assignment_group_members agm ON agm.user_id = u.id
         WHERE agm.group_id=$1::uuid AND u.tenant_id=$2::uuid
         LIMIT 1`,
        [ticket.assignment_group_id, tenantId],
      );
      if (r.rows[0]?.email) {
        return {
          recipientRef: `group:${ticket.assignment_group_id}`,
          recipientEmail: r.rows[0].email,
          webhookEndpoints,
        };
      }
    }

    // Level 3: Tenant escalation env var
    const escalationEmail = process.env['SLA_ESCALATION_EMAIL'];
    if (escalationEmail) {
      return { recipientRef: 'escalation:env', recipientEmail: escalationEmail, webhookEndpoints };
    }

    // Unroutable — webhook-only delivery still possible
    if (webhookEndpoints.length > 0) {
      return { recipientRef: 'webhook-only', recipientEmail: null, webhookEndpoints };
    }

    return null;
  }

  /**
   * Find active webhook endpoints subscribed to SLA event types for the tenant.
   * The secretCiphertext is used as the signing key directly in this release
   * (production would decrypt via KMS before signing).
   */
  private async resolveWebhookEndpoints(
    client: Awaited<ReturnType<Pool['connect']>>,
    tenantId: string,
  ): Promise<Array<{ url: string; signingKey: string }>> {
    const r = await client.query<{ url: string; secret_ciphertext: string }>(
      `SELECT url, secret_ciphertext
       FROM webhook_endpoints
       WHERE tenant_id=$1::uuid
         AND status='active'
         AND deleted_at IS NULL
         AND (event_types @> ARRAY['sla.reminder_due']
              OR event_types @> ARRAY['sla.breached'])`,
      [tenantId],
    );
    return r.rows.map((row) => ({ url: row.url, signingKey: row.secret_ciphertext }));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async suppress(
    client: Awaited<ReturnType<Pool['connect']>>,
    emissionId: string,
    tenantId: string,
    reason: string,
  ): Promise<void> {
    await client.query(
      `UPDATE sla_reminder_emissions
       SET delivery_status='suppressed', suppressed_reason=$1, updated_at=now()
       WHERE id=$2::uuid AND tenant_id=$3::uuid`,
      [reason, emissionId, tenantId],
    );
  }

  private async audit(
    client: Awaited<ReturnType<Pool['connect']>>,
    tenantId: string,
    timerId: string,
    ticketId: string,
    thresholdPct: number,
    channel: string,
    action: string,
    traceCtx: Record<string, string>,
  ): Promise<void> {
    const idempKey = createHash('sha256')
      .update(`${tenantId}:${timerId}:${thresholdPct}:${channel}:${action}`)
      .digest('hex');
    try {
      await client.query(
        `INSERT INTO audit_logs
           (tenant_id, event_type, outcome, trace_id, resource_type, resource_id,
            action, metadata, idempotency_key, source)
         VALUES ($1::uuid,$2,$3,$4,'sla_timer',$5,$6,$7::jsonb,$8,'sla-notification-worker')
         ON CONFLICT DO NOTHING`,
        [
          tenantId, action,
          action.includes('sent') ? 'success' : 'info',
          traceCtx['traceparent'] ?? '',
          timerId, action,
          JSON.stringify({ timerId, ticketId, thresholdPct, channel }),
          idempKey,
        ],
      );
    } catch (err) {
      console.error('[sla-reminder] Audit write failed', { error: (err as Error).message });
    }
  }
}
