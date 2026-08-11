/**
 * html-escape.ts — context-aware HTML escaper for PDF report templates (WO-077).
 *
 * SECURITY CONTRACT:
 *   - Every string interpolated into the PDF template MUST pass through `escapeHtml()`.
 *   - The escaper is the only approved mechanism for incorporating data values into
 *     HTML markup. Triple-stache / raw output in Handlebars and dangerouslySetInnerHTML
 *     in React are banned by the ESLint config.
 *   - The escaper handles the five HTML metacharacters plus additional characters that
 *     could enable attacks in browser-parsed HTML: backtick (template literals in
 *     embedded <script>), forward slash (protocol-relative URLs), and Unicode direction-
 *     override / zero-width characters that can spoof displayed text.
 *
 * Characters escaped:
 *   &   → &amp;
 *   <   → &lt;
 *   >   → &gt;
 *   "   → &quot;
 *   '   → &#x27;
 *   `   → &#x60;
 *   /   → &#x2F;  (breaks </script> injection)
 *   ‪-‮ (LTR/RTL overrides)       → [BIDI]
 *   ⁦-⁩ (Isolate bidi markers)    → [BIDI]
 *   ﻿ (BOM / zero-width no-break space) → (removed)
 *   ​-‍ (zero-width joiners)      → (removed)
 *
 * NULL / undefined → '' (safe empty string, never the string "null").
 * Numbers/booleans are coerced to string before escaping.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&':  '&amp;',
  '<':  '&lt;',
  '>':  '&gt;',
  '"':  '&quot;',
  "'":  '&#x27;',
  '`':  '&#x60;',
  '/':  '&#x2F;',
};

// Regexp: HTML metacharacters + bidi override range + zero-width chars + BOM.
const ESCAPE_RE = /[&<>"'`/‪-‮⁦-⁩﻿​-‍]/g;

function replaceChar(char: string): string {
  if (char in HTML_ESCAPE_MAP) return HTML_ESCAPE_MAP[char]!;
  // Bidi override range U+202A–U+202E and U+2066–U+2069
  const cp = char.codePointAt(0) ?? 0;
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) {
    return '[BIDI]';
  }
  // Zero-width chars and BOM — silently drop
  return '';
}

/**
 * Escape a value for safe interpolation into an HTML document.
 *
 * @param value - any value; null/undefined become empty string
 * @returns HTML-safe string
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str.replace(ESCAPE_RE, replaceChar);
}

/**
 * Escape an attribute value.  The surrounding quotes must be double-quotes
 * in the template — the escaper replaces inner double-quotes with &quot;.
 *
 * This is a thin alias for escapeHtml; named separately to make intent clear
 * at call sites and to allow specialisation in future without changing callers.
 */
export const escapeAttr = escapeHtml;

/**
 * Escape a URL for use in href / src attributes.
 *
 * Extra hardening beyond escapeHtml:
 *   - Rejects javascript:, vbscript: and data: schemes → returns '#'.
 *   - Applies escapeHtml to the resulting string.
 *
 * @param url - candidate URL string
 * @returns safe URL string (never a javascript: or data: URI)
 */
export function escapeUrl(url: unknown): string {
  if (url === null || url === undefined) return '#';
  const str = String(url).trim();
  // Block dangerous URI schemes regardless of case or whitespace tricks.
  if (/^(?:javascript|vbscript|data)\s*:/i.test(str)) return '#';
  return escapeHtml(str);
}
