/**
 * filename-sanitiser.ts — sanitises user-supplied filenames for safe storage.
 *
 * Rules applied (in order):
 *   1. Strip null bytes (\0).
 *   2. Normalise unicode (NFC) to collapse combining characters.
 *   3. Strip path separators (/ \) and directory traversal sequences (.. ./).
 *   4. Strip leading dots (hidden file convention, e.g. .bash_history).
 *   5. Strip trailing dots and spaces (Windows filename edge cases).
 *   6. Truncate to MAX_FILENAME_LENGTH characters.
 *   7. If the result is empty after sanitisation, return FALLBACK_FILENAME.
 *
 * The output is ONLY used as a display name in the API response. The S3 storage
 * key is ALWAYS a server-generated UUID path — it never derives from this value.
 *
 * Pure function — no side effects, no I/O. Safe to test exhaustively.
 */

const MAX_FILENAME_LENGTH = 255;
const FALLBACK_FILENAME = 'attachment';

/**
 * Sanitise a user-supplied filename into a safe display name.
 *
 * @param raw  The raw filename string from the client.
 * @returns    A sanitised filename string, never empty.
 */
export function sanitiseFilename(raw: string): string {
  if (!raw || typeof raw !== 'string') return FALLBACK_FILENAME;

  let name = raw;

  // 1. Remove null bytes
  name = name.replace(/\0/g, '');

  // 2. Normalise unicode
  name = name.normalize('NFC');

  // 3. Take only the basename — strip everything up to and including the
  //    last path separator (covers both / and \).
  const lastSep = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSep !== -1) {
    name = name.slice(lastSep + 1);
  }

  // 4. Remove directory traversal sequences
  name = name.replace(/\.\./g, '').replace(/\.\//g, '').replace(/\.\\/g, '');

  // 5. Remove remaining path separator characters
  name = name.replace(/[/\\]/g, '');

  // 6. Strip leading dots (hidden files)
  name = name.replace(/^\.+/, '');

  // 7. Strip trailing dots and spaces
  name = name.replace(/[.\s]+$/, '');

  // 8. Truncate
  if (name.length > MAX_FILENAME_LENGTH) {
    // Preserve extension when truncating
    const dotIdx = name.lastIndexOf('.');
    if (dotIdx > 0) {
      const ext = name.slice(dotIdx); // e.g. ".pdf"
      const base = name.slice(0, MAX_FILENAME_LENGTH - ext.length);
      name = base + ext;
    } else {
      name = name.slice(0, MAX_FILENAME_LENGTH);
    }
  }

  // 9. Fallback for empty result
  if (!name) return FALLBACK_FILENAME;

  return name;
}

/**
 * Extract the lowercase file extension from a sanitised filename.
 * Returns '' when there is no extension.
 *
 * @param filename  A sanitised filename (already passed through sanitiseFilename).
 */
export function extractExtension(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx < 0 || dotIdx === filename.length - 1) return '';
  return filename.slice(dotIdx + 1).toLowerCase();
}
