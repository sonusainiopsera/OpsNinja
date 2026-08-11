/**
 * Browser entry point for @opsninja/api-client.
 *
 * Exports the full client including SessionManager (silent refresh via
 * browser-managed httpOnly cookie) and TanStack Query integration.
 */

export { ApiError, EXPIRED_TOKEN_CODES, SCOPE_CHANGED_CODES, isApiError } from './errors/ApiError';
export type { ApiErrorOptions } from './errors/ApiError';

export { parseErrorEnvelope, parseRetryAfter, MAX_RETRY_AFTER_MS } from './errors/parseErrorEnvelope';

export { createRequestFn } from './transport/request';
export type { RequestConfig, RequestOptions, RequestFn } from './transport/request';

export { withRetry, shouldRetry, computeBackoffMs } from './transport/retry';
export type { RetryConfig } from './transport/retry';

export {
  normalizeCursorRequest,
  cursorQueryParams,
  getNextPageParam,
  MAX_PAGE_LIMIT,
  MIN_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
} from './pagination/cursor';
export type {
  CursorPageRequest,
  CursorPageResponse,
  NormalizedPageRequest,
  InfinitePageParam,
} from './pagination/cursor';

export { SessionManager } from './session/SessionManager';
export type {
  SessionEvent,
  SessionEventListener,
  SessionManagerConfig,
} from './session/SessionManager';

export { createOpsninjaQueryClient } from './query/createOpsninjaQueryClient';
export { queryKeys } from './query/queryKeys';
export type { QueryContext } from './query/queryKeys';

// ---------------------------------------------------------------------------
// Client factory — convenience builder for browser apps.
// ---------------------------------------------------------------------------

import { createRequestFn, type RequestConfig } from './transport/request';
import { SessionManager } from './session/SessionManager';

export interface OpsninjaClientOptions extends RequestConfig {
  refreshPath?: string;
}

export interface OpsninjaClient {
  request: ReturnType<typeof createRequestFn>;
  session: SessionManager;
}

export function createOpsninjaClient(opts: OpsninjaClientOptions): OpsninjaClient {
  const request = createRequestFn(opts);
  const session = new SessionManager({ request, refreshPath: opts.refreshPath });
  return { request, session };
}
