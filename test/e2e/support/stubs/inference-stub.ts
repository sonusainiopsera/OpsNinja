/**
 * Inference provider stub — deterministic double for AI synthesis tests.
 *
 * Starts a lightweight HTTP server that the API's AI synthesis worker calls
 * instead of the real inference provider.
 *
 * Modes:
 *   success (default) — returns a fixed structured summary payload
 *   forced_failure    — returns HTTP 500 so the ai_status failed path is tested
 *
 * The stub is scoped per-test: each test that needs it creates its own
 * instance so state never leaks across parallel tests.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';

export interface InferenceStubOptions {
  /** Port to listen on (default: 19101). */
  port?: number;
  /** Initial mode (default: 'success'). */
  mode?: 'success' | 'forced_failure';
}

export const FIXED_SUMMARY = {
  summary: '[STUB] Customer reported inability to authenticate via SSO. Root cause: IdP metadata expired.',
  affectedAreaTags: ['auth', 'sso', 'idp'],
};

export class InferenceStub {
  private readonly server: Server;
  private mode: 'success' | 'forced_failure';
  readonly port: number;

  constructor(opts: InferenceStubOptions = {}) {
    this.port = opts.port ?? 19101;
    this.mode = opts.mode ?? 'success';
    this.server = createServer(this._handler.bind(this));
  }

  private _handler(_req: IncomingMessage, res: ServerResponse): void {
    if (this.mode === 'forced_failure') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'stub_forced_failure' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(FIXED_SUMMARY));
  }

  /** Switch the stub to forced-failure mode for the current test. */
  setFailureMode(): void {
    this.mode = 'forced_failure';
  }

  /** Restore the stub to success mode. */
  setSuccessMode(): void {
    this.mode = 'success';
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
