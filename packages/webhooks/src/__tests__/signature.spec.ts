import { createHmac } from 'crypto';
import { buildSignatureHeader, verifySignatureHeader } from '../signature';

// Known-answer test vector
// secret = 'abc123' (base64url) → HMAC of '1717200000.{"id":"evt-1"}'
function computeExpected(secret: string, timestamp: number, body: string): string {
  const payload = `${timestamp}.${body}`;
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(payload).digest('hex');
}

const SECRET = 'c2VjcmV0MTIz';   // base64url of 'secret123'
const PREV_SECRET = 'cHJldlNlY3JldA';  // base64url of 'prevSecret'
const BODY = '{"id":"evt-1","type":"ticket.created"}';
const FIXED_TS = 1717200000;

describe('buildSignatureHeader', () => {
  it('produces t= and v1= with correct HMAC (known-answer vector)', () => {
    const { header, timestamp } = buildSignatureHeader(BODY, SECRET, undefined, () => FIXED_TS);
    const expected = computeExpected(SECRET, FIXED_TS, BODY);

    expect(timestamp).toBe(FIXED_TS);
    expect(header).toBe(`t=${FIXED_TS},v1=${expected}`);
  });

  it('produces two v1= entries during rotation grace window', () => {
    const { header } = buildSignatureHeader(BODY, SECRET, PREV_SECRET, () => FIXED_TS);
    const currentHex = computeExpected(SECRET, FIXED_TS, BODY);
    const prevHex = computeExpected(PREV_SECRET, FIXED_TS, BODY);

    expect(header).toBe(`t=${FIXED_TS},v1=${currentHex},v1=${prevHex}`);
  });

  it('current and previous v1 values differ', () => {
    const { header } = buildSignatureHeader(BODY, SECRET, PREV_SECRET, () => FIXED_TS);
    const parts = header.split(',');
    const v1s = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    expect(v1s).toHaveLength(2);
    expect(v1s[0]).not.toBe(v1s[1]);
  });

  it('is deterministic for the same inputs', () => {
    const a = buildSignatureHeader(BODY, SECRET, undefined, () => FIXED_TS);
    const b = buildSignatureHeader(BODY, SECRET, undefined, () => FIXED_TS);
    expect(a.header).toBe(b.header);
  });
});

describe('verifySignatureHeader', () => {
  it('returns true for a valid single-secret header', () => {
    const { header } = buildSignatureHeader(BODY, SECRET, undefined, () => FIXED_TS);
    expect(verifySignatureHeader(header, BODY, SECRET, 300, () => FIXED_TS)).toBe(true);
  });

  it('returns true when rotation header matches previous secret', () => {
    const { header } = buildSignatureHeader(BODY, SECRET, PREV_SECRET, () => FIXED_TS);
    expect(verifySignatureHeader(header, BODY, PREV_SECRET, 300, () => FIXED_TS)).toBe(true);
  });

  it('returns false for wrong secret', () => {
    const { header } = buildSignatureHeader(BODY, SECRET, undefined, () => FIXED_TS);
    expect(verifySignatureHeader(header, BODY, 'd3Jvbmcx', 300, () => FIXED_TS)).toBe(false);
  });

  it('returns false when body is tampered', () => {
    const { header } = buildSignatureHeader(BODY, SECRET, undefined, () => FIXED_TS);
    expect(verifySignatureHeader(header, BODY + 'X', SECRET, 300, () => FIXED_TS)).toBe(false);
  });

  it('returns false when timestamp is outside tolerance (replay)', () => {
    const { header } = buildSignatureHeader(BODY, SECRET, undefined, () => FIXED_TS);
    // clock is 301 seconds ahead → outside 300s window
    expect(verifySignatureHeader(header, BODY, SECRET, 300, () => FIXED_TS + 301)).toBe(false);
  });

  it('returns true exactly at the tolerance boundary', () => {
    const { header } = buildSignatureHeader(BODY, SECRET, undefined, () => FIXED_TS);
    expect(verifySignatureHeader(header, BODY, SECRET, 300, () => FIXED_TS + 300)).toBe(true);
  });

  it('returns false for malformed header', () => {
    expect(verifySignatureHeader('garbage', BODY, SECRET, 300, () => FIXED_TS)).toBe(false);
    expect(verifySignatureHeader('t=abc,v1=notHex', BODY, SECRET, 300, () => FIXED_TS)).toBe(false);
  });
});
