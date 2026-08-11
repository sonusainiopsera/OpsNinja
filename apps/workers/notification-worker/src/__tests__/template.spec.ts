/**
 * Unit tests for NotificationTemplateService rendering and escaping.
 */

import Handlebars from 'handlebars';

// ── Inline template rendering tests (no DB dependency) ────────────────────────

describe('Handlebars template rendering', () => {
  it('escapes HTML in variable values by default', () => {
    const tmpl = Handlebars.compile('<p>{{subject}}</p>', { noEscape: false });
    const result = tmpl({ subject: '<script>alert("xss")</script>' });
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes angle brackets and ampersands', () => {
    const tmpl = Handlebars.compile('{{val}}');
    expect(tmpl({ val: '<b>bold</b>' })).toBe('&lt;b&gt;bold&lt;/b&gt;');
    expect(tmpl({ val: 'a & b' })).toBe('a &amp; b');
  });

  it('renders a quoted string without injection when value contains single quotes', () => {
    const tmpl = Handlebars.compile("Subject: {{subject}}");
    const result = tmpl({ subject: "'; DROP TABLE notifications; --" });
    expect(result).toBe("Subject: &#x27;; DROP TABLE notifications; --");
  });

  it('renders safe text correctly', () => {
    const tmpl = Handlebars.compile('Hello {{name}}, your ticket #{{id}} is ready.');
    const result = tmpl({ name: 'Alice', id: '12345' });
    expect(result).toBe('Hello Alice, your ticket #12345 is ready.');
  });

  it('renders empty string for undefined variable', () => {
    const tmpl = Handlebars.compile('Hello {{name}}');
    expect(tmpl({})).toBe('Hello ');
  });

  it('does not render triple-brace unescaped output when template is compile-time safe', () => {
    // All templates must use {{var}}, never {{{var}}}.
    // This test confirms escaping is consistent.
    const safeTmpl = Handlebars.compile('{{body}}');
    const result = safeTmpl({ body: '<p>Click <a href="#">here</a></p>' });
    expect(result).not.toContain('<p>');
    expect(result).toContain('&lt;p&gt;');
  });
});

// ── Log redaction ──────────────────────────────────────────────────────────────

describe('Log redaction (log-redactor)', () => {
  let redactLogRecord: (obj: object) => object;
  let containsEmail: (input: string) => boolean;

  beforeEach(() => {
    const mod = require('@opsninja/observability');
    redactLogRecord = mod.redactLogRecord;
    containsEmail = mod.containsEmail;
  });

  it('strips email addresses from log objects', () => {
    const record = { tenantId: 't1', recipientEmail: 'user@example.com', outcome: 'sent' };
    const redacted = redactLogRecord({ ...record });
    expect(JSON.stringify(redacted)).not.toMatch(/user@example\.com/);
  });

  it('strips inline email addresses from string values', () => {
    const record = { message: 'sent to user@example.com successfully' };
    const redacted = redactLogRecord({ ...record });
    expect(JSON.stringify(redacted)).not.toMatch(/user@example\.com/);
  });

  it('containsEmail returns true for email-containing strings', () => {
    expect(containsEmail('send to foo@bar.com now')).toBe(true);
    expect(containsEmail('no email here')).toBe(false);
  });

  it('does not alter fields without emails', () => {
    const record = { tenantId: 'abc', outcome: 'sent', attempts: 1 };
    const redacted = redactLogRecord({ ...record }) as typeof record;
    expect(redacted.tenantId).toBe('abc');
    expect(redacted.outcome).toBe('sent');
  });
});

// ── SES error classification ───────────────────────────────────────────────────

describe('classifySesError', () => {
  let classifySesError: (err: { name: string; $response?: { statusCode: number } }) => string;

  beforeEach(() => {
    const mod = require('../adapters/ses-error-classifier');
    classifySesError = mod.classifySesError;
  });

  it('classifies TooManyRequestsException as RETRYABLE', () => {
    expect(classifySesError({ name: 'TooManyRequestsException' })).toBe('RETRYABLE');
  });

  it('classifies MessageRejected as TERMINAL', () => {
    expect(classifySesError({ name: 'MessageRejected' })).toBe('TERMINAL');
  });

  it('classifies unknown 500-class errors as RETRYABLE', () => {
    expect(classifySesError({ name: 'UnknownError', $response: { statusCode: 503 } })).toBe('RETRYABLE');
  });

  it('classifies unknown 400-class errors as TERMINAL', () => {
    expect(classifySesError({ name: 'UnknownError', $response: { statusCode: 400 } })).toBe('TERMINAL');
  });
});
