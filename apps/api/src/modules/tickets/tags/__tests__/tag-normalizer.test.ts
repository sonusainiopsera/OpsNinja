import { describe, it, expect } from 'vitest';
import { normalizeTagSlug, isSameSlug } from '../tag-normalizer.js';

describe('normalizeTagSlug', () => {
  it('lowercases ASCII letters', () => {
    expect(normalizeTagSlug('BugFix')).toBe('bugfix');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTagSlug('  bug  ')).toBe('bug');
  });

  it('collapses internal whitespace to a single hyphen', () => {
    expect(normalizeTagSlug('Bug Fix')).toBe('bug-fix');
  });

  it('collapses multiple internal spaces to one hyphen', () => {
    expect(normalizeTagSlug('Bug   Fix')).toBe('bug-fix');
  });

  it('replaces tabs with hyphens', () => {
    expect(normalizeTagSlug('bug\tfix')).toBe('bug-fix');
  });

  it('strips punctuation', () => {
    expect(normalizeTagSlug('P1 / Critical')).toBe('p1-critical');
  });

  it('strips leading slash after normalisation', () => {
    expect(normalizeTagSlug('/leading-slash')).toBe('leading-slash');
  });

  it('collapses consecutive hyphens', () => {
    expect(normalizeTagSlug('A -- B')).toBe('a-b');
  });

  it('strips non-ASCII unicode characters', () => {
    expect(normalizeTagSlug('café')).toBe('caf');
  });

  it('strips emoji', () => {
    expect(normalizeTagSlug('🐛 bug')).toBe('bug');
  });

  it('handles all-punctuation input', () => {
    expect(normalizeTagSlug('!!!---!!!')).toBe('');
  });

  it('handles empty string', () => {
    expect(normalizeTagSlug('')).toBe('');
  });

  it('preserves hyphens already in the name', () => {
    expect(normalizeTagSlug('bug-fix')).toBe('bug-fix');
  });

  it('strips trailing hyphen after stripping trailing punctuation', () => {
    expect(normalizeTagSlug('bug!')).toBe('bug');
  });

  it('handles alphanumeric with digits', () => {
    expect(normalizeTagSlug('P1 Priority')).toBe('p1-priority');
  });
});

describe('isSameSlug', () => {
  it('returns true for identical names', () => {
    expect(isSameSlug('Bug', 'Bug')).toBe(true);
  });

  it('returns true for same name with different case', () => {
    expect(isSameSlug('Bug', 'bug')).toBe(true);
  });

  it('returns true for same name with trailing whitespace', () => {
    expect(isSameSlug('Bug  ', '  Bug')).toBe(true);
  });

  it('returns false for different names', () => {
    expect(isSameSlug('Bug', 'Enhancement')).toBe(false);
  });

  it('returns false for prefix vs full name', () => {
    expect(isSameSlug('Bug', 'Bug Fix')).toBe(false);
  });
});
