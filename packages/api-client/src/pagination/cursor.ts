/**
 * Cursor pagination helpers.
 *
 * API contract:
 *   Request:  ?cursor=<opaque>&limit=<int, max 100>
 *   Response: { data: T[], pagination: { nextCursor: string | null } }
 *
 * Limit is hard-clamped to [1, 100] client-side to match the API cap.
 * Callers passing limit=0, negative, or >100 are silently corrected.
 * Offset semantics are never assumed.
 */

export const MAX_PAGE_LIMIT = 100;
export const MIN_PAGE_LIMIT = 1;
export const DEFAULT_PAGE_LIMIT = 20;

export interface CursorPageRequest {
  cursor?: string;
  limit?: number;
}

export interface CursorPageResponse<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
  };
}

export interface NormalizedPageRequest {
  cursor: string | undefined;
  limit: number;
}

/**
 * Normalise a page request, clamping limit into [1, 100].
 * limit=0, negative → MIN_PAGE_LIMIT; limit>100 → MAX_PAGE_LIMIT.
 */
export function normalizeCursorRequest(req: CursorPageRequest): NormalizedPageRequest {
  const rawLimit = req.limit ?? DEFAULT_PAGE_LIMIT;
  const limit = Math.max(MIN_PAGE_LIMIT, Math.min(MAX_PAGE_LIMIT, Math.trunc(rawLimit)));
  return {
    cursor: req.cursor,
    limit,
  };
}

/**
 * Build query params from a normalised cursor request.
 * Returns an object suitable for the `query` field of RequestOptions.
 */
export function cursorQueryParams(
  req: CursorPageRequest,
): Record<string, string | number | undefined> {
  const { cursor, limit } = normalizeCursorRequest(req);
  return {
    ...(cursor !== undefined ? { cursor } : {}),
    limit,
  };
}

/** TanStack Query infinite-query compatible shape. */
export interface InfinitePageParam {
  cursor: string | undefined;
}

export function getNextPageParam<T>(
  page: CursorPageResponse<T>,
): InfinitePageParam | undefined {
  return page.pagination.nextCursor !== null
    ? { cursor: page.pagination.nextCursor }
    : undefined;
}
