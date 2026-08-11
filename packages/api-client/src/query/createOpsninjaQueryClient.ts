/**
 * createOpsninjaQueryClient — TanStack Query v5 client factory.
 *
 * Retry rules aligned to the API status taxonomy:
 *   - Never retry: 400, 401, 403, 404, 409, 422 — these are deterministic.
 *   - Retry with backoff: 429, 5xx — transient or rate-limited.
 *   - Non-ApiError network failures: retry up to 2 times.
 *
 * The staleTime and gcTime defaults are deliberately conservative; consumers
 * can override per-query.
 */

import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';
import { ApiError } from '../errors/ApiError';

const NEVER_RETRY_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (failureCount >= 2) return false;
  if (err instanceof ApiError) {
    return !NEVER_RETRY_STATUSES.has(err.status);
  }
  // Network-level failures: retry up to 2 times.
  return true;
}

export function createOpsninjaQueryClient(
  overrides?: Partial<QueryClientConfig>,
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: 30_000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
    ...overrides,
  });
}
