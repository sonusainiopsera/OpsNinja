export const MAX_PAGE_LIMIT = 100;
export const MIN_PAGE_LIMIT = 1;

export interface CursorPageParams {
  cursor?: string | null;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
  };
}

export interface PageQueryParams {
  cursor?: string;
  limit: number;
}

/**
 * Clamps the limit to [1, 100] to match the API cap.
 * Negative numbers and zero are clamped to 1.
 * Values above 100 are clamped to 100.
 */
export function clampLimit(limit: number | undefined | null): number {
  if (limit === undefined || limit === null || isNaN(limit)) return MAX_PAGE_LIMIT;
  return Math.max(MIN_PAGE_LIMIT, Math.min(MAX_PAGE_LIMIT, Math.floor(limit)));
}

export function buildPageParams(params: CursorPageParams): PageQueryParams {
  const result: PageQueryParams = { limit: clampLimit(params.limit) };
  if (params.cursor) result.cursor = params.cursor;
  return result;
}

export function getNextCursor<T>(response: PaginatedResponse<T>): string | null {
  return response.pagination.nextCursor;
}

export function hasNextPage<T>(response: PaginatedResponse<T>): boolean {
  return response.pagination.nextCursor !== null;
}
