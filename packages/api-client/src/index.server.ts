/**
 * Server / RSC entry point for @opsninja/api-client.
 *
 * Server-side usage requirements:
 *   - Cookies MUST be forwarded explicitly from the incoming request headers.
 *     The httpOnly refresh cookie is not accessible to JS; the access token
 *     must be passed as a cookie header when making server-side requests.
 *   - Silent browser refresh is NOT available server-side — there is no browser
 *     to manage the rotating httpOnly cookie exchange.
 *   - If cookies are not forwarded this entry point throws a configuration error
 *     rather than silently issuing an unauthenticated request.
 *
 * Import as: import { ... } from '@opsninja/api-client/server'
 */

// Re-export everything from browser entry except SessionManager.
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
} from './pagination/cursor';
export type { CursorPageRequest, CursorPageResponse } from './pagination/cursor';

export { createOpsninjaQueryClient } from './query/createOpsninjaQueryClient';
export { queryKeys } from './query/queryKeys';
export type { QueryContext } from './query/queryKeys';

// ---------------------------------------------------------------------------
// Server client factory — requires explicit cookie forwarding.
// ---------------------------------------------------------------------------

import { createRequestFn, type RequestConfig } from './transport/request';

export interface ServerClientOptions extends Omit<RequestConfig, 'fetch'> {
  /**
   * Forwarded Cookie header from the incoming request.
   * Required — throws if not provided (fail-explicit over fail-silent).
   */
  cookieHeader: string;
  fetchImpl?: typeof globalThis.fetch;
}

export function createServerClient(opts: ServerClientOptions) {
  if (!opts.cookieHeader) {
    throw new Error(
      '[api-client/server] cookieHeader is required for server-side requests. ' +
        'Forward the incoming request Cookie header explicitly. ' +
        'The httpOnly refresh cookie cannot be browser-managed in a server context.',
    );
  }

  const baseHeaders: Record<string, string> = {
    Cookie: opts.cookieHeader,
  };

  // Wrap fetch to inject the forwarded Cookie header on every request.
  const fetchWithCookies: typeof globalThis.fetch = (input, init) => {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    return fetchImpl(input, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers ?? {}).entries()),
        ...baseHeaders,
      },
    });
  };

  return createRequestFn({ ...opts, fetch: fetchWithCookies });
}
