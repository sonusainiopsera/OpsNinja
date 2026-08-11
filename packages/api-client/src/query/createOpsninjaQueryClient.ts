import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../errors/ApiError';

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/**
 * Creates a configured TanStack Query v5 QueryClient with retry rules aligned
 * to the OpsNinja API status taxonomy.
 *
 * Never retries: 400, 401, 403, 404, 409, 422
 * Retries with backoff: 429 (honoring Retry-After), 5xx
 */
export function createOpsninjaQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            if (NON_RETRYABLE_STATUSES.has(error.status)) return false;
            // Transport errors and 5xx: up to 2 retries
            if (error.status === 0 || error.status >= 500) return failureCount < 2;
            // 429: up to 3 retries (Retry-After handled by SessionManager/transport)
            if (error.status === 429) return failureCount < 3;
            return false;
          }
          // Unknown errors: retry once
          return failureCount < 1;
        },
        retryDelay: (failureCount, error) => {
          if (error instanceof ApiError && error.status === 429 && error.retryAfterMs !== undefined) {
            // Add jitter: ±25%
            const base = error.retryAfterMs;
            return Math.round(base * (0.75 + Math.random() * 0.5));
          }
          // Exponential backoff: 1s, 2s, 4s ...
          return Math.min(1_000 * 2 ** failureCount, 30_000);
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
