/**
 * magic-bytes.ts — true content-type detection via leading byte signatures.
 *
 * Each entry in MAGIC_TABLE maps a MIME type to an array of byte sequences
 * (as hex strings) that appear at the start of a valid file of that type.
 * Multiple sequences cover alternative headers (e.g. JFIF vs Exif JPEG).
 *
 * Detection algorithm:
 *   1. Read the first N bytes of the file (N = 16 is sufficient for this set).
 *   2. For each entry in MAGIC_TABLE (checked in declaration order), test
 *      whether the leading bytes start with the signature bytes.
 *   3. Return the MIME type of the first matching entry.
 *   4. If no entry matches, return 'application/octet-stream'.
 *
 * ALLOWED_EXTENSIONS maps each detected MIME to the file extensions that are
 * considered legitimate for that type. An extension NOT in this list causes
 * a mismatch rejection in finalization.
 *
 * Pure functions — no I/O, no framework imports. Fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Magic byte table
// ---------------------------------------------------------------------------

interface MagicEntry {
  mime: string;
  /** Hex strings of byte prefixes that identify this type. */
  signatures: string[];
}

/**
 * Allowed MIME types and their magic byte signatures.
 * Unrecognised files fall back to 'application/octet-stream'.
 */
export const MAGIC_TABLE: readonly MagicEntry[] = [
  // PNG: \x89PNG\r\n\x1a\n
  { mime: 'image/png',  signatures: ['89504e47'] },

  // JPEG: FF D8 FF (JFIF/Exif/etc)
  { mime: 'image/jpeg', signatures: ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2', 'ffd8ffdb', 'ffd8ffee'] },

  // GIF: GIF87a or GIF89a
  { mime: 'image/gif',  signatures: ['47494638'] },

  // WebP: RIFF....WEBP
  { mime: 'image/webp', signatures: ['52494646'] }, // RIFF — checked via full signature below

  // PDF: %PDF-
  { mime: 'application/pdf', signatures: ['25504446'] },

  // ZIP: PK\x03\x04 (also docx, xlsx, etc — extension cross-check distinguishes)
  { mime: 'application/zip', signatures: ['504b0304', '504b0506', '504b0708'] },

  // GZIP: \x1f\x8b
  { mime: 'application/gzip', signatures: ['1f8b'] },

  // Plain text: UTF-8 BOM or printable ASCII start (heuristic — checked last)
  // Note: plain text has no reliable magic bytes; we detect the BOM only.
  { mime: 'text/plain', signatures: ['efbbbf'] }, // UTF-8 BOM
];

/**
 * Allowed file extensions per detected MIME type.
 * Extensions must be lowercase, without the leading dot.
 * An extension not in this map is treated as blocked.
 */
export const ALLOWED_EXTENSIONS: Readonly<Record<string, string[]>> = {
  'image/png':          ['png'],
  'image/jpeg':         ['jpg', 'jpeg'],
  'image/gif':          ['gif'],
  'image/webp':         ['webp'],
  'application/pdf':    ['pdf'],
  'application/zip':    ['zip'],
  'application/gzip':   ['gz', 'gzip', 'tgz'],
  'text/plain':         ['txt', 'log', 'csv', 'tsv', 'md'],
  // Catch-all for unrecognised types
  'application/octet-stream': ['bin', 'dat'],
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the true MIME type of content by inspecting its leading bytes.
 *
 * @param leadingBytes  The first N bytes of the file content (N ≥ 8 recommended).
 * @returns             The detected MIME type string.
 */
export function detectMimeFromBytes(leadingBytes: Buffer): string {
  const hex = leadingBytes.toString('hex').toLowerCase();

  for (const entry of MAGIC_TABLE) {
    for (const sig of entry.signatures) {
      if (hex.startsWith(sig)) {
        // Special case: WebP needs RIFF + WEBP at offset 8
        if (entry.mime === 'image/webp') {
          const webpMarker = leadingBytes.toString('ascii', 8, 12);
          if (webpMarker !== 'WEBP') continue;
        }
        return entry.mime;
      }
    }
  }

  // Heuristic plain-text detection: if all leading bytes are printable ASCII
  // (0x09, 0x0A, 0x0D, 0x20–0x7E) treat as text/plain
  if (isLikelyText(leadingBytes)) {
    return 'text/plain';
  }

  return 'application/octet-stream';
}

function isLikelyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  for (const byte of sample) {
    const isPrintable =
      byte === 0x09 || // TAB
      byte === 0x0a || // LF
      byte === 0x0d || // CR
      (byte >= 0x20 && byte <= 0x7e); // printable ASCII
    if (!isPrintable) return false;
  }
  return sample.length > 0;
}

// ---------------------------------------------------------------------------
// Allow-list validation
// ---------------------------------------------------------------------------

export interface MimeCheckResult {
  /** True when the detected MIME matches the extension allow-list. */
  allowed: boolean;
  detectedMime: string;
  /** The extension derived from the filename (lowercase, no dot). */
  extension: string;
  /** Reason code when not allowed. */
  reason?: 'EXTENSION_MISMATCH' | 'EXTENSION_BLOCKED';
}

/**
 * Validate that the true detected MIME type is compatible with the declared
 * file extension and is on the allow-list.
 *
 * @param leadingBytes   First N bytes of the uploaded file.
 * @param extension      Lowercase extension from sanitised filename (no dot).
 */
export function validateMimeAndExtension(
  leadingBytes: Buffer,
  extension: string,
): MimeCheckResult {
  const detectedMime = detectMimeFromBytes(leadingBytes);
  const allowedExts = ALLOWED_EXTENSIONS[detectedMime];

  if (!allowedExts) {
    return { allowed: false, detectedMime, extension, reason: 'EXTENSION_BLOCKED' };
  }

  if (!allowedExts.includes(extension)) {
    return { allowed: false, detectedMime, extension, reason: 'EXTENSION_MISMATCH' };
  }

  return { allowed: true, detectedMime, extension };
}
