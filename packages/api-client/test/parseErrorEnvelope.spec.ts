import { describe, it, expect } from 'vitest';
import { parseErrorEnvelope, parseRetryAfter, MAX_RETRY_AFTER_MS } from '../src/errors/parseErrorEnvelope';
import { ApiError } from '../src/errors/ApiError';

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const bodyStr = body === null ? null : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('parseErrorEnvelope', () => {
  it('parses a well-formed error envelope', async () => {
    const response = makeResponse(400, {
      error: { code: 'VALIDATION_ERROR', message: 'bad input', details: [{ field: 'x' }], traceId: 'tr-1' },
    });
    const err = await parseErrorEnvelope(response, 'synthetic');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.traceId).toBe('tr-1');
    expect(err.details).toHaveLength(1);
  });

  it('uses synthetic traceId when envelope has none', async () => {
    const response = makeResponse(500, { error: { code: 'ERR', message: 'boom' } });
    const err = await parseErrorEnvelope(response, 'synth-trace');
    expect(err.traceId).toBe('synth-trace');
  });

  it('handles empty body gracefully', async () => {
    const response = makeResponse(503, null);
    const err = await parseErrorEnvelope(response, 'synth');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.code).toBe('SERVER_ERROR');
  });

  it('handles non-JSON HTML body gracefully', async () => {
    const response = new Response('<html>Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    const err = await parseErrorEnvelope(response, 'synth');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('SERVER_ERROR');
  });

  it('handles truncated/malformed JSON', async () => {
    const response = new Response('{"error":{', { status: 500 });
    const err = await parseErrorEnvelope(response, 'synth');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });

  it('parses Retry-After from envelope for 429', async () => {
    const response = makeResponse(
      429,
      { error: { code: 'RATE_LIMITED', message: 'slow down', details: [], traceId: 'tr' } },
      { 'Retry-After': '30' },
    );
    const err = await parseErrorEnvelope(response, 'synth');
    expect(err.retryAfterMs).toBe(30_000);
  });

  it('extracts currentVersion from 409 envelope', async () => {
    const response = makeResponse(409, {
      error: { code: 'CONFLICT', message: 'conflict', details: [], traceId: 'tr', currentVersion: 'v7' },
    });
    const err = await parseErrorEnvelope(response, 'synth');
    expect(err.currentVersion).toBe('v7');
  });

  it('uses synthetic codes for each status when envelope is absent', async () => {
    const cases: [number, string][] = [
      [400, 'VALIDATION_ERROR'],
      [401, 'UNAUTHENTICATED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'CONFLICT'],
      [422, 'BUSINESS_RULE_VIOLATION'],
      [429, 'RATE_LIMITED'],
      [500, 'SERVER_ERROR'],
    ];
    for (const [status, expectedCode] of cases) {
      const response = makeResponse(status, null);
      const err = await parseErrorEnvelope(response, 'synth');
      expect(err.code).toBe(expectedCode);
    }
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('60')).toBe(60_000);
  });

  it('caps at MAX_RETRY_AFTER_MS', () => {
    expect(parseRetryAfter('999999')).toBe(MAX_RETRY_AFTER_MS);
  });

  it('returns 0 for null', () => {
    expect(parseRetryAfter(null)).toBe(0);
  });

  it('returns 0 for unparseable value', () => {
    expect(parseRetryAfter('not-a-date-or-number')).toBe(0);
  });

  it('parses HTTP-date form', () => {
    const futureDate = new Date(Date.now() + 10_000);
    const retryMs = parseRetryAfter(futureDate.toUTCString(), Date.now());
    expect(retryMs).toBeGreaterThan(9_000);
    expect(retryMs).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS);
  });

  it('treats past HTTP-date as 0 (clock-skew safe)', () => {
    const pastDate = new Date(Date.now() - 5_000);
    expect(parseRetryAfter(pastDate.toUTCString(), Date.now())).toBe(0);
  });
});
