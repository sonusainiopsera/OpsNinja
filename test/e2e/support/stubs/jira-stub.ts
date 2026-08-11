/**
 * Jira double — deterministic stub for Jira integration tests.
 *
 * Simulates the Jira Cloud REST API for issue creation and exposes a
 * helper to emit a signed inbound webhook transition back to the OpsNinja
 * webhook receiver, enabling full round-trip testing without a real Jira instance.
 *
 * The stub:
 *   - Accepts POST /rest/api/3/issue → returns a deterministic issue key
 *   - Records all received requests for assertion
 *   - Emits a signed webhook to the OpsNinja receiver on demand
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { createHmac } from 'crypto';

export interface JiraStubOptions {
  port?: number;
  /** HMAC-SHA256 secret for signing outbound Jira webhooks (matches OpsNinja config). */
  webhookSecret?: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

let issueCounter = 1000;

export class JiraStub {
  private readonly server: Server;
  readonly port: number;
  private readonly webhookSecret: string;
  readonly requests: RecordedRequest[] = [];

  constructor(opts: JiraStubOptions = {}) {
    this.port = opts.port ?? 19102;
    this.webhookSecret = opts.webhookSecret ?? 'jira-stub-secret';
    this.server = createServer(this._handler.bind(this));
  }

  private _handler(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { parsed = body; }

      this.requests.push({ method: req.method ?? 'GET', path: req.url ?? '/', body: parsed });

      if (req.method === 'POST' && req.url?.startsWith('/rest/api/3/issue')) {
        const issueKey = `OPSNINJA-${issueCounter++}`;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: String(issueCounter), key: issueKey, self: `${this.baseUrl}/rest/api/3/issue/${issueKey}` }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  }

  /**
   * Emit a signed Jira transition webhook to the OpsNinja receiver.
   * The body is a realistic Jira issue_updated event.
   */
  async emitTransitionWebhook(receiverUrl: string, opts: {
    issueKey: string;
    toStatus: string;
    ticketId?: string;
  }): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      timestamp,
      webhookEvent: 'jira:issue_updated',
      issue_event_type_name: 'issue_generic',
      issue: {
        key: opts.issueKey,
        fields: {
          status: { name: opts.toStatus, statusCategory: { key: 'done' } },
          summary: 'Test issue',
        },
      },
      ...(opts.ticketId ? { opsninja_ticket_id: opts.ticketId } : {}),
    };
    const rawBody = JSON.stringify(payload);
    const sig = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const res = await fetch(receiverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': `sha256=${sig}`,
      },
      body: rawBody,
    });
    if (!res.ok) {
      throw new Error(`Jira webhook delivery failed: ${res.status} ${await res.text()}`);
    }
  }

  /** Clear recorded requests (call between tests). */
  clear(): void {
    this.requests.length = 0;
  }

  start(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.port, '127.0.0.1', resolve));
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}
