/**
 * Tag slug normalisation — pure functions with no side effects.
 *
 * Normalisation rules (applied in order):
 *  1. Lowercase.
 *  2. Trim leading/trailing whitespace.
 *  3. Collapse internal whitespace runs to a single hyphen.
 *  4. Strip every character that is not [a-z0-9-].
 *  5. Collapse consecutive hyphens to one.
 *  6. Strip leading/trailing hyphens.
 *
 * The unique index on (tenant_id, slug) enforces de-dup at DB level,
 * eliminating the race window on concurrent creates.
 */

/**
 * Normalise a tag name into a URL-safe slug.
 *
 * @example
 *   normalizeTagSlug('Bug Fix')        → 'bug-fix'
 *   normalizeTagSlug('  P1 / Critical') → 'p1-critical'
 *   normalizeTagSlug('café')           → 'caf'
 */
export function normalizeTagSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')          // collapse whitespace → hyphens
    .replace(/[^a-z0-9-]/g, '')   // strip non-alphanumeric / non-hyphen
    .replace(/-{2,}/g, '-')        // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');      // trim leading/trailing hyphens
}

/**
 * True when two names would produce the same slug (case-insensitive de-dup).
 */
export function isSameSlug(a: string, b: string): boolean {
  return normalizeTagSlug(a) === normalizeTagSlug(b);
}
