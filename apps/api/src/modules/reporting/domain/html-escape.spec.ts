/**
 * Unit tests for html-escape.ts — WO-077 AC-9, AC-10.
 *
 * Asserts that all HTML metacharacters, injection vectors, bidi overrides
 * and zero-width characters are neutralised before template interpolation.
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr, escapeUrl } from './html-escape';

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#x27;');
  });

  it('escapes backtick and forward-slash to block embedded-script injection', () => {
    expect(escapeHtml('`')).toBe('&#x60;');
    expect(escapeHtml('/')).toBe('&#x2F;');
  });

  it('renders a script tag as visible literal text', () => {
    const hostile = '<script>alert("xss")</script>';
    const result  = escapeHtml(hostile);
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('</script>');
  });

  it('renders quote characters as visible literal text (AC-9)', () => {
    const hostile = 'He said "hello" and it\'s fine';
    const result  = escapeHtml(hostile);
    expect(result).toContain('&quot;hello&quot;');
    expect(result).toContain('&#x27;');
    expect(result).not.toContain('"hello"');
  });

  it('renders angle brackets as visible literal text', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const result  = escapeHtml(hostile);
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });

  it('neutralises right-to-left bidi override characters', () => {
    const bidiOverride = '‮';           // RIGHT-TO-LEFT OVERRIDE
    expect(escapeHtml(bidiOverride)).toBe('[BIDI]');
  });

  it('neutralises left-to-right bidi override characters', () => {
    const bidi = '‪‫‬‭‮';
    const result = escapeHtml(bidi);
    expect(result).toBe('[BIDI][BIDI][BIDI][BIDI][BIDI]');
  });

  it('neutralises Unicode isolate bidi markers', () => {
    const isolate = '⁦⁧⁨⁩';
    const result = escapeHtml(isolate);
    expect(result).toBe('[BIDI][BIDI][BIDI][BIDI]');
  });

  it('removes zero-width joiners and BOM', () => {
    const zwj = '​‌‍';        // zero-width space, non-joiner, joiner
    expect(escapeHtml(zwj)).toBe('');
    expect(escapeHtml('﻿')).toBe('');   // BOM
  });

  it('handles null and undefined gracefully', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces numbers and booleans to strings', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
    expect(escapeHtml(0)).toBe('0');
  });

  it('passes through safe strings unchanged', () => {
    const safe = 'Ticket resolution time: 4h 23m (avg)';
    expect(escapeHtml(safe)).toBe('Ticket resolution time: 4h 23m (avg)');
  });

  it('handles iframe injection', () => {
    const iframe = '<iframe src="https://evil.com"></iframe>';
    const result = escapeHtml(iframe);
    expect(result).not.toContain('<iframe');
    expect(result).toContain('&lt;iframe');
  });

  it('handles data URI injection attempt', () => {
    const dataUri = '<img src="data:text/html,<script>alert(1)</script>">';
    const result = escapeHtml(dataUri);
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });
});

describe('escapeAttr', () => {
  it('is equivalent to escapeHtml for attribute context', () => {
    const val = '" onmouseover="alert(1)';
    expect(escapeAttr(val)).toBe('&quot; onmouseover=&quot;alert(1)');
  });
});

describe('escapeUrl', () => {
  it('blocks javascript: scheme', () => {
    expect(escapeUrl('javascript:alert(1)')).toBe('#');
    expect(escapeUrl('JAVASCRIPT:alert(1)')).toBe('#');
    expect(escapeUrl('javascript  :alert(1)')).toBe('#');
  });

  it('blocks vbscript: scheme', () => {
    expect(escapeUrl('vbscript:msgbox(1)')).toBe('#');
  });

  it('blocks data: scheme', () => {
    expect(escapeUrl('data:text/html,<h1>pwned</h1>')).toBe('#');
  });

  it('allows https: URLs', () => {
    const url = 'https://example.com/report?x=1&y=2';
    const result = escapeUrl(url);
    expect(result).not.toBe('#');
    expect(result).toContain('https:');
    expect(result).toContain('&amp;');   // & is still escaped for HTML context
  });

  it('handles null/undefined gracefully', () => {
    expect(escapeUrl(null)).toBe('#');
    expect(escapeUrl(undefined)).toBe('#');
  });

  it('handles file:// reference by escaping, not blocking', () => {
    // file:// is not in the blocked scheme list; the sandbox blocks the fetch.
    // The URL is still HTML-escaped so it cannot become an injection vector.
    const result = escapeUrl('file:///etc/passwd');
    expect(result).not.toBe('#');
    expect(result).toContain('&#x2F;&#x2F;&#x2F;');
  });
});
