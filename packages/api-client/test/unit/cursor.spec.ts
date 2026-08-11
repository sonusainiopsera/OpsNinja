import { describe, it, expect } from 'vitest';
import { clampLimit, buildPageParams, hasNextPage, MAX_PAGE_LIMIT } from '../../src/pagination/cursor';

describe('clampLimit', () => {
  it('clamps 500 to 100', () => expect(clampLimit(500)).toBe(100));
  it('clamps 101 to 100', () => expect(clampLimit(101)).toBe(100));
  it('keeps 100 as 100', () => expect(clampLimit(100)).toBe(100));
  it('keeps 50 as 50', () => expect(clampLimit(50)).toBe(50));
  it('clamps 0 to 1', () => expect(clampLimit(0)).toBe(1));
  it('clamps -5 to 1', () => expect(clampLimit(-5)).toBe(1));
  it('defaults undefined to MAX_PAGE_LIMIT', () => expect(clampLimit(undefined)).toBe(MAX_PAGE_LIMIT));
  it('defaults null to MAX_PAGE_LIMIT', () => expect(clampLimit(null)).toBe(MAX_PAGE_LIMIT));
  it('floors floats', () => expect(clampLimit(50.9)).toBe(50));
});

describe('buildPageParams', () => {
  it('includes cursor when provided', () => {
    const p = buildPageParams({ cursor: 'abc', limit: 20 });
    expect(p.cursor).toBe('abc');
    expect(p.limit).toBe(20);
  });

  it('omits cursor when null', () => {
    const p = buildPageParams({ cursor: null, limit: 20 });
    expect(p.cursor).toBeUndefined();
  });

  it('clamps limit', () => {
    const p = buildPageParams({ limit: 200 });
    expect(p.limit).toBe(100);
  });
});

describe('hasNextPage', () => {
  it('returns true when nextCursor is set', () => {
    expect(hasNextPage({ data: [], pagination: { nextCursor: 'cursor' } })).toBe(true);
  });
  it('returns false when nextCursor is null', () => {
    expect(hasNextPage({ data: [], pagination: { nextCursor: null } })).toBe(false);
  });
});
