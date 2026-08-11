/**
 * SessionManager — single-flight refresh and 401 disambiguation.
 *
 * Critical invariants:
 *   1. Exactly ONE refresh request in flight at a time.
 *      N concurrent 401s share the same refreshPromise and all replay after it settles.
 *   2. A replayed request that 401s again MUST NOT trigger a second refresh.
 *      The _isReplay flag on RequestOptions is the loop guard.
 *   3. A scope-changed 401 (AUTH_REAUTHORIZE_REQUIRED / org_scope_changed) is
 *      NEVER silently retried — it clears state and emits 'reauthorization-required'.
 *   4. An unrecognised 401 code fails CLOSED to reauthorization-required, not to refresh.
 *      Silently honouring an unknown 401 as an expiry would be an access-control defect.
 *   5. The refresh token is an httpOnly SameSite=Strict cookie — the client NEVER
 *      reads, stores or sends it manually. Refresh is a credentialed POST only.
 */

import { ApiError } from '../errors/ApiError';
import type { RequestFn, RequestOptions } from '../transport/request';

export type SessionEvent = 'unauthenticated' | 'reauthorization-required';
export type SessionEventListener = (event: SessionEvent) => void;

export interface SessionManagerConfig {
  /** Injected request function (already bound to base URL and credentials). */
  request: RequestFn;
  /** Path of the refresh endpoint. Default: '/api/v1/auth/refresh'. */
  refreshPath?: string;
}

export class SessionManager {
  private refreshPromise: Promise<void> | null = null;
  private readonly listeners = new Set<SessionEventListener>();
  private readonly refreshPath: string;
  private readonly request: RequestFn;

  constructor(config: SessionManagerConfig) {
    this.request = config.request;
    this.refreshPath = config.refreshPath ?? '/api/v1/auth/refresh';
  }

  on(listener: SessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener failures must not affect the session management flow
      }
    }
  }

  /**
   * Execute a request with automatic 401 handling.
   * Returns the parsed response T on success.
   */
  async execute<T>(opts: RequestOptions): Promise<T> {
    try {
      return await this.request<T>(opts);
    } catch (err) {
      if (!(err instanceof ApiError) || !err.isUnauthenticated()) {
        throw err;
      }

      // A replayed request got 401 again — loop guard: do not refresh again.
      if (opts._isReplay) {
        this.emit('reauthorization-required');
        throw err;
      }

      // Scope-changed: MUST NOT be silently retried.
      if (err.isScopeChanged()) {
        this.emit('reauthorization-required');
        throw err;
      }

      // Unrecognised 401 code — fail closed to reauthorization-required.
      if (!err.isExpiredToken()) {
        this.emit('reauthorization-required');
        throw err;
      }

      // Expired token — attempt single-flight refresh.
      try {
        await this.ensureRefresh();
      } catch (refreshErr) {
        // Refresh failed — session is dead.
        this.emit('unauthenticated');
        throw refreshErr;
      }

      // Replay the original request exactly once with the loop guard set.
      return this.request<T>({ ...opts, _isReplay: true });
    }
  }

  /**
   * Start (or join an in-flight) refresh.
   * All concurrent callers share the same promise — exactly one POST is made.
   */
  private ensureRefresh(): Promise<void> {
    if (this.refreshPromise === null) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  /**
   * POST /api/v1/auth/refresh with credentials.
   * The httpOnly cookie is sent automatically by the browser — we read nothing from JS.
   */
  private async doRefresh(): Promise<void> {
    try {
      await this.request({
        method: 'POST',
        path: this.refreshPath,
        // No body — the refresh cookie is browser-managed.
      });
    } catch (err) {
      // Surface the underlying error; callers map it to unauthenticated event.
      throw err;
    }
  }
}
