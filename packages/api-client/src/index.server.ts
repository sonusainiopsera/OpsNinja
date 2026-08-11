/**
 * Server-side / RSC entry point.
 *
 * This entry point must only be used in server components, API routes, and
 * server actions. It does NOT support silent browser token refresh — the
 * server cannot read the httpOnly refresh cookie on behalf of the browser.
 *
 * Usage:
 *   import { createServerApiClient } from '@opsninja/api-client/server';
 *   const client = createServerApiClient({ baseUrl, cookieHeader });
 *
 * If cookieHeader is not provided the client will throw a configuration error
 * rather than silently issuing unauthenticated requests.
 */

export * from './errors/ApiError';
export * from './errors/parseErrorEnvelope';
export * from './pagination/cursor';
export * from './query/queryKeys';
export type * from './generated/openapi-types';

import type { ClientConfig } from './transport/request';
import { request } from './transport/request';
import { ApiError } from './errors/ApiError';

export interface ServerClientOptions {
  baseUrl: string;
  /** The forwarded Cookie header from the incoming request (required). */
  cookieHeader: string;
  timeoutMs?: number;
}

/**
 * Creates a fetch wrapper that forwards the server-request cookies explicitly.
 * This is required because credentials:'include' is a browser-only behaviour.
 */
export function createServerApiClient(options: ServerClientOptions) {
  if (!options.cookieHeader) {
    throw new ApiError({
      status: 0,
      code: 'SERVER_CLIENT_MISCONFIGURED',
      message:
        'Server API client requires cookieHeader to be provided. ' +
        'Forward the incoming request Cookie header from the RSC/route handler.',
    });
  }

  const serverFetch: typeof globalThis.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Cookie', options.cookieHeader);
    return globalThis.fetch(input, { ...init, headers, credentials: 'include' });
  };

  const config: ClientConfig = {
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    fetch: serverFetch,
  };

  return {
    get: <T>(path: string, params?: Record<string, string | number | boolean | null | undefined>) =>
      request<T>(config, { method: 'GET', path, params }),
    post: <T>(path: string, body: unknown) =>
      request<T>(config, { method: 'POST', path, body }),
    put: <T>(path: string, body: unknown) =>
      request<T>(config, { method: 'PUT', path, body }),
    patch: <T>(path: string, body: unknown) =>
      request<T>(config, { method: 'PATCH', path, body }),
    delete: <T>(path: string) =>
      request<T>(config, { method: 'DELETE', path }),
  };
}
