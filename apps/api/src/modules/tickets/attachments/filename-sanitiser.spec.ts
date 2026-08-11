/**
 * filename-sanitiser.spec.ts — exhaustive unit tests for the filename sanitiser.
 *
 * Tests are independent and parallel-safe (pure functions, no I/O, no state).
 */

import { sanitiseFilename, extractExtension } from './filename-sanitiser';

describe('sanitiseFilename', () => {
  // ── Normal input ─────────────────────────────────────────────────────────

  it('returns a simple filename unchanged', () => {
    expect(sanitiseFilename('report.pdf')).toBe('report.pdf');
  });

  it('preserves extension', () => {
    expect(sanitiseFilename('screenshot.png')).toBe('screenshot.png');
  });

  // ── Path traversal ────────────────────────────────────────────────────────

  it('strips Unix path separators, taking only the basename', () => {
    expect(sanitiseFilename('/etc/passwd')).toBe('passwd');
  });

  it('strips Windows path separators', () => {
    expect(sanitiseFilename('C:\\Users\\admin\\secret.txt')).toBe('secret.txt');
  });

  it('strips ../ sequences', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFilename('../../../secret.key')).toBe('secret.key');
  });

  it('strips ..\\  Windows traversal', () => {
    expect(sanitiseFilename('..\\..\\windows\\system32\\config')).toBe('config');
  });

  // ── Leading dots ──────────────────────────────────────────────────────────

  it('strips a single leading dot', () => {
    expect(sanitiseFilename('.bashrc')).toBe('bashrc');
  });

  it('strips multiple leading dots', () => {
    expect(sanitiseFilename('...hidden')).toBe('hidden');
  });

  it('preserves a leading dot in the extension context (e.g. .env should strip)', () => {
    expect(sanitiseFilename('.env')).toBe('env');
  });

  // ── Null bytes ────────────────────────────────────────────────────────────

  it('strips null bytes', () => {
    expect(sanitiseFilename('file\0name.txt')).toBe('filename.txt');
  });

  it('strips null bytes before extension', () => {
    expect(sanitiseFilename('malware\0.exe.pdf')).toBe('malware.exe.pdf');
  });

  // ── Trailing dots and spaces ──────────────────────────────────────────────

  it('strips trailing dots', () => {
    expect(sanitiseFilename('filename...')).toBe('filename');
  });

  it('strips trailing spaces', () => {
    expect(sanitiseFilename('file name   ')).toBe('file name');
  });

  // ── Empty / degenerate input ──────────────────────────────────────────────

  it('returns fallback for empty string', () => {
    expect(sanitiseFilename('')).toBe('attachment');
  });

  it('returns fallback for only dots', () => {
    expect(sanitiseFilename('...')).toBe('attachment');
  });

  it('returns fallback for only path separators', () => {
    expect(sanitiseFilename('///')).toBe('attachment');
  });

  it('returns fallback for non-string input', () => {
    expect(sanitiseFilename(null as unknown as string)).toBe('attachment');
    expect(sanitiseFilename(undefined as unknown as string)).toBe('attachment');
  });

  // ── Long filenames ────────────────────────────────────────────────────────

  it('truncates long filenames preserving extension', () => {
    const longBase = 'a'.repeat(300);
    const result = sanitiseFilename(longBase + '.pdf');
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('truncates long filenames without extension', () => {
    const result = sanitiseFilename('b'.repeat(300));
    expect(result.length).toBeLessThanOrEqual(255);
  });

  // ── Unicode ───────────────────────────────────────────────────────────────

  it('normalises unicode (NFC)', () => {
    // Café with combining accent vs precomposed form
    const decomposed = 'cafe\u0301.txt';  // NFC produces café.txt
    const result = sanitiseFilename(decomposed);
    expect(result).toBe('café.txt');
  });
});

describe('extractExtension', () => {
  it('returns lowercase extension without dot', () => {
    expect(extractExtension('report.PDF')).toBe('pdf');
    expect(extractExtension('photo.JPEG')).toBe('jpeg');
  });

  it('returns empty string when no extension', () => {
    expect(extractExtension('Makefile')).toBe('');
  });

  it('returns empty string for trailing dot', () => {
    expect(extractExtension('file.')).toBe('');
  });

  it('handles double extensions (returns last)', () => {
    expect(extractExtension('archive.tar.gz')).toBe('gz');
  });
});
