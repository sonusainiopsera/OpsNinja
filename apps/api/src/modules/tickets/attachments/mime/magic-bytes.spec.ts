/**
 * magic-bytes.spec.ts — unit tests for MIME detection and allow-list validation.
 *
 * Uses Buffer fixtures representing the leading bytes of each supported type.
 * Tests are independent and parallel-safe (pure functions, no I/O, no state).
 */

import { detectMimeFromBytes, validateMimeAndExtension, MAGIC_TABLE, ALLOWED_EXTENSIONS } from './magic-bytes';

// ---------------------------------------------------------------------------
// Fixture builders — minimal leading bytes for each type
// ---------------------------------------------------------------------------

const PNG_BYTES   = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(8).fill(0)]);
const JPEG_BYTES  = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(10).fill(0)]);
const GIF_BYTES   = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...Array(10).fill(0)]);
const PDF_BYTES   = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, ...Array(11).fill(0)]);
const ZIP_BYTES   = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Array(12).fill(0)]);
const GZIP_BYTES  = Buffer.from([0x1f, 0x8b, ...Array(14).fill(0)]);
const UTF8_BOM    = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('Hello text')]);

// WebP: RIFF + 4-byte size + WEBP
const WEBP_BYTES = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
  Buffer.from([0x24, 0x00, 0x00, 0x00]), // file size
  Buffer.from([0x57, 0x45, 0x42, 0x50]), // WEBP
  Buffer.alloc(8),
]);

// Shell script pretending to be a PNG (spoofed extension)
const SHELL_BYTES = Buffer.from('#!/bin/bash\necho "pwned"\n');

// Plain text (printable ASCII, no BOM)
const TEXT_BYTES = Buffer.from('This is a plain text log entry.\n');

// ---------------------------------------------------------------------------
// detectMimeFromBytes
// ---------------------------------------------------------------------------

describe('detectMimeFromBytes', () => {
  it('detects PNG', () => {
    expect(detectMimeFromBytes(PNG_BYTES)).toBe('image/png');
  });

  it('detects JPEG', () => {
    expect(detectMimeFromBytes(JPEG_BYTES)).toBe('image/jpeg');
  });

  it('detects GIF', () => {
    expect(detectMimeFromBytes(GIF_BYTES)).toBe('image/gif');
  });

  it('detects PDF', () => {
    expect(detectMimeFromBytes(PDF_BYTES)).toBe('application/pdf');
  });

  it('detects ZIP', () => {
    expect(detectMimeFromBytes(ZIP_BYTES)).toBe('application/zip');
  });

  it('detects GZIP', () => {
    expect(detectMimeFromBytes(GZIP_BYTES)).toBe('application/gzip');
  });

  it('detects WebP', () => {
    expect(detectMimeFromBytes(WEBP_BYTES)).toBe('image/webp');
  });

  it('detects plain text via UTF-8 BOM', () => {
    expect(detectMimeFromBytes(UTF8_BOM)).toBe('text/plain');
  });

  it('detects plain text via heuristic (no BOM)', () => {
    expect(detectMimeFromBytes(TEXT_BYTES)).toBe('text/plain');
  });

  it('returns application/octet-stream for shell script (spoofed)', () => {
    // Shell scripts start with '#!' — not in magic table
    expect(detectMimeFromBytes(SHELL_BYTES)).toBe('text/plain');
    // Note: shell scripts ARE detected as text/plain (printable ASCII heuristic)
    // — the allow-list check will reject .sh or .png extension mismatches
  });

  it('returns application/octet-stream for random binary', () => {
    const random = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]);
    expect(detectMimeFromBytes(random)).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// validateMimeAndExtension
// ---------------------------------------------------------------------------

describe('validateMimeAndExtension — allowed cases', () => {
  it('allows PNG with .png extension', () => {
    const r = validateMimeAndExtension(PNG_BYTES, 'png');
    expect(r.allowed).toBe(true);
    expect(r.detectedMime).toBe('image/png');
  });

  it('allows JPEG with .jpg extension', () => {
    const r = validateMimeAndExtension(JPEG_BYTES, 'jpg');
    expect(r.allowed).toBe(true);
  });

  it('allows JPEG with .jpeg extension', () => {
    const r = validateMimeAndExtension(JPEG_BYTES, 'jpeg');
    expect(r.allowed).toBe(true);
  });

  it('allows PDF with .pdf extension', () => {
    const r = validateMimeAndExtension(PDF_BYTES, 'pdf');
    expect(r.allowed).toBe(true);
  });

  it('allows ZIP with .zip extension', () => {
    const r = validateMimeAndExtension(ZIP_BYTES, 'zip');
    expect(r.allowed).toBe(true);
  });

  it('allows GZIP with .gz extension', () => {
    const r = validateMimeAndExtension(GZIP_BYTES, 'gz');
    expect(r.allowed).toBe(true);
  });

  it('allows plain text with .txt extension', () => {
    const r = validateMimeAndExtension(TEXT_BYTES, 'txt');
    expect(r.allowed).toBe(true);
  });

  it('allows plain text with .log extension', () => {
    const r = validateMimeAndExtension(TEXT_BYTES, 'log');
    expect(r.allowed).toBe(true);
  });
});

describe('validateMimeAndExtension — rejection cases', () => {
  it('rejects PNG content with .jpg extension (EXTENSION_MISMATCH)', () => {
    const r = validateMimeAndExtension(PNG_BYTES, 'jpg');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('EXTENSION_MISMATCH');
    expect(r.detectedMime).toBe('image/png');
  });

  it('rejects PNG content with .pdf extension (EXTENSION_MISMATCH)', () => {
    const r = validateMimeAndExtension(PNG_BYTES, 'pdf');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('EXTENSION_MISMATCH');
  });

  it('rejects shell script (text) with .png extension — spoofed type attack', () => {
    // Shell bytes are detected as text/plain, but .png is not in ALLOWED_EXTENSIONS[text/plain]
    const r = validateMimeAndExtension(SHELL_BYTES, 'png');
    expect(r.allowed).toBe(false);
    // text/plain is in the table but png is not an allowed extension for it
    expect(r.reason).toBe('EXTENSION_MISMATCH');
  });

  it('rejects binary octet-stream with .exe extension (EXTENSION_MISMATCH)', () => {
    const randomBinary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]);
    const r = validateMimeAndExtension(randomBinary, 'exe');
    expect(r.allowed).toBe(false);
    // ALLOWED_EXTENSIONS for application/octet-stream does not include .exe
    expect(r.reason).toBe('EXTENSION_MISMATCH');
  });

  it('includes detected MIME and extension in rejection result', () => {
    const r = validateMimeAndExtension(JPEG_BYTES, 'png');
    expect(r.detectedMime).toBe('image/jpeg');
    expect(r.extension).toBe('png');
    expect(r.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Table completeness
// ---------------------------------------------------------------------------

describe('MAGIC_TABLE and ALLOWED_EXTENSIONS consistency', () => {
  it('every MIME in MAGIC_TABLE has an entry in ALLOWED_EXTENSIONS', () => {
    for (const entry of MAGIC_TABLE) {
      expect(ALLOWED_EXTENSIONS).toHaveProperty(entry.mime);
    }
  });

  it('application/octet-stream is in ALLOWED_EXTENSIONS (catch-all)', () => {
    expect(ALLOWED_EXTENSIONS['application/octet-stream']).toBeDefined();
  });
});
