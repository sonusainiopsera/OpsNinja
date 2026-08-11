import { describe, it, expect } from 'vitest';
import {
  normalizeCursorRequest,
  cursorQueryParams,
  getNextPageParam,
  MAX_PAGE_LIMIT,
  MIN_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
} from '../src/pagination/cursor';

describe('normalizeCursorRequest — limit clamping', () => {
  it('passes through a valid limit', () => {
    expect(normalizeCursorRequest({ limit: 20 }).limit).toBe(20);
  });

  it('clamps limit > 100 down to 100', () => {
    expect(normalizeCursorRequest({ limit: 500 }).limit).toBe(MAX_PAGE_LIMIT);
  });

  it('clamps limit = 0 up to 1', () => {
    expect(normalizeCursorRequest({ limit: 0 }).limit).toBe(MIN_PAGE_LIMIT);
  });

  it('clamps negative limit up to 1', () => {
    expect(normalizeCursorRequest({ limit: -10 }).limit).toBe(MIN_PAGE_LIMIT);
  });

  it('uses DEFAULT_PAGE_LIMIT when limit is absent', () => {
    expect(normalizeCursorRequest({}).limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('passes through cursor', () => {
    expect(normalizeCursorRequest({ cursor: 'abc' }).cursor).toBe('abc');
  });

  it('cursor is undefined when not provided', () => {
    expect(normalizeCursorRequest({ limit: 10 }).cursor).toBeUndefined();
  });
});

describe('cursorQueryParams', () => {
  it('includes limit and cursor in params', () => {
    const params = cursorQueryParams({ cursor: 'xyz', limit: 50 });
    expect(params['limit']).toBe(50);
    expect(params['cursor']).toBe('xyz');
  });

  it('omits cursor when not provided', () => {
    const params = cursorQueryParams({ limit: 10 });
    expect(params['cursor']).toBeUndefined();
  });

  it('clamps limit in query params', () => {
    const params = cursorQueryParams({ limit: 999 });
    expect(params['limit']).toBe(MAX_PAGE_LIMIT);
  });
});

describe('getNextPageParam', () => {
  it('returns next cursor when present', () => {
    const page = { data: [], pagination: { nextCursor: 'next-abc' } };
    expect(getNextPageParam(page)).toEqual({ cursor: 'next-abc' });
  });

  it('returns undefined when nextCursor is null (last page)', () => {
    const page = { data: [], pagination: { nextCursor: null } };
    expect(getNextPageParam(page)).toBeUndefined();
  });
});
