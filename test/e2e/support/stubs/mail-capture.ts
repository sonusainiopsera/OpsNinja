/**
 * Mail capture stub — intercepts outbound emails for CSAT and reminder assertions.
 *
 * Starts an HTTP server that the notification worker's SMTP transport POSTs
 * to instead of hitting a real mail provider.  Tests can assert that specific
 * emails were sent to specific recipients without an external mail service.
 *
 * The stub supports:
 *   - Capturing all sent messages in memory
 *   - Waiting for a message matching a predicate (with eventual-consistency)
 *   - Extracting links from captured email bodies for CSAT token assertions
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';

export interface CapturedMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  timestamp: number;
  templateKey?: string;
}

export class MailCaptureStub {
  private readonly server: Server;
  readonly port: number;
  readonly messages: CapturedMessage[] = [];

  constructor(port = 19103) {
    this.port = port;
    this.server = createServer(this._handler.bind(this));
  }

  private _handler(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body) as Partial<CapturedMessage>;
        this.messages.push({
          to: msg.to ?? '',
          subject: msg.subject ?? '',
          html: msg.html ?? '',
          text: msg.text ?? '',
          templateKey: msg.templateKey,
          timestamp: Date.now(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messageId: `stub-${Date.now()}` }));
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
  }

  /** Wait up to timeoutMs for a message matching predicate. */
  async waitForMessage(
    predicate: (m: CapturedMessage) => boolean,
    timeoutMs = 15_000,
  ): Promise<CapturedMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Mail capture: no message matched predicate within ${timeoutMs}ms`);
  }

  /** Extract the first URL from a message body matching a pattern. */
  extractLink(message: CapturedMessage, pattern: RegExp): string | null {
    const match = message.html.match(pattern);
    return match?.[1] ?? null;
  }

  clear(): void {
    this.messages.length = 0;
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
