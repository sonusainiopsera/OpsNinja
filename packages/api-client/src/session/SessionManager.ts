import { ApiError, isUnauthenticated } from '../errors/ApiError';
import type { ClientConfig } from '../transport/request';
import { request } from '../transport/request';

/**
 * 401 error codes that indicate the access token is expired and can be silently
 * refreshed. Any other 401 code is treated as reauthorization-required.
 */
const EXPIRED_TOKEN_CODES = new Set(['AUTH_TOKEN_EXPIRED', 'TOKEN_EXPIRED', 'token_expired']);

/**
 * 401 codes that explicitly signal an org scope change. These must NEVER be
 * silently retried — stale scope must not be honoured.
 */
const SCOPE_CHANGED_CODES = new Set([
  'AUTH_REAUTHORIZE_REQUIRED',
  'SCOPE_VERSION_STALE',
  'org_scope_changed',
  'scope_version_stale',
]);

export type SessionEventType = 'unauthenticated' | 'reauthorization-required';

export type SessionEventListener = (event: SessionEventType) => void;

export interface SessionManagerOptions {
  config: ClientConfig;
  /** Called once per session-transition (unauthenticated or reauthorization-required) */
  onSessionEvent?: SessionEventListener;
}

/**
 * Determines what should happen when a 401 is received.
 */
export type AuthAction = 'refresh-and-replay' | 'reauthorize' | 'unauthenticated';

export function classify401(err: ApiError): AuthAction {
  if (!isUnauthenticated(err)) return 'unauthenticated';

  if (SCOPE_CHANGED_CODES.has(err.code)) {
    // Scope-changed: force re-auth, ZERO retries
    return 'reauthorize';
  }

  if (EXPIRED_TOKEN_CODES.has(err.code)) {
    return 'refresh-and-replay';
  }

  // Unknown 401 code: fail closed to re-authorization
  return 'reauthorize';
}

export class SessionManager {
  private refreshPromise: Promise<void> | null = null;
  private listeners = new Set<SessionEventListener>();

  private readonly config: ClientConfig;

  constructor(options: SessionManagerOptions) {
    this.config = options.config;
    if (options.onSessionEvent) {
      this.listeners.add(options.onSessionEvent);
    }
  }

  addEventListener(listener: SessionEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: SessionEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: SessionEventType): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Never let a listener crash the session manager
      }
    }
  }

  /**
   * Single-flight refresh: if a refresh is already in flight all callers share
   * the same Promise and await it together. Only one HTTP call is made.
   */
  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    try {
      await request<unknown>(this.config, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        _isRefresh: true,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          this.emit('unauthenticated');
        } else if (err.status === 429) {
          // Surface 429 from refresh — do not loop
          this.emit('unauthenticated');
        }
        // 5xx: transient — let the error bubble up without emitting session event
      }
      throw err;
    }
  }

  /**
   * Handles a 401 error from any request.
   *
   * - Expired token: single-flight refresh, then signals to replay once.
   * - Scope-changed: emit reauthorization-required, no refresh, no replay.
   * - Unknown: fail closed, emit reauthorization-required.
   *
   * @param err       The 401 ApiError received
   * @param isReplay  True if this request was already a replay (loop guard)
   * @returns         true if the caller should replay the original request
   */
  async handle401(err: ApiError, isReplay: boolean): Promise<boolean> {
    const action = classify401(err);

    if (action === 'reauthorize') {
      this.emit('reauthorization-required');
      return false;
    }

    if (action === 'refresh-and-replay') {
      // Loop guard: a replayed request that 401s again must not trigger another refresh
      if (isReplay) {
        this.emit('reauthorization-required');
        return false;
      }

      try {
        await this.refresh();
        return true; // signal: replay the original request
      } catch {
        // Refresh failed — session is cleared; event already emitted in doRefresh
        return false;
      }
    }

    // 'unauthenticated' (fallthrough — should not happen but be safe)
    this.emit('unauthenticated');
    return false;
  }

  /**
   * Wraps a request, handling silent token refresh for expired-token 401s.
   *
   * @param fetchFn A function that performs the actual request call. Receives
   *                a boolean indicating whether this is a replay attempt.
   */
  async executeWithRefresh<T>(fetchFn: (isReplay: boolean) => Promise<T>): Promise<T> {
    try {
      return await fetchFn(false);
    } catch (err) {
      if (!(err instanceof ApiError) || !isUnauthenticated(err)) throw err;

      const shouldReplay = await this.handle401(err, false);
      if (!shouldReplay) throw err;

      // Replay once
      return fetchFn(true);
    }
  }
}
