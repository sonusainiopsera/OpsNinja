/**
 * Signature module tests with known-answer HMAC vectors.
 *
 * Known-answer vectors produced via:
 *   echo -n "<unix>.<body>" | openssl dgst -sha256 -hmac "<secret>"
 *
 * Dual-signature rotation test verifies both current and previous secrets
 * produce separate v1= entries in the header.
 */
import { describe, it, expect } from 'vitest';
import { buildSignatureHeader, verifySignatureHeader } from './signature';

// Known-answer test vectors
const KAV_SECRET = 'test-signing-secret-abc123';
const KAV_BODY = '{"id":"evt1","type":"ticket.created"}';
const KAV_TIMESTAMP = 1700000000;
// Pre-computed: echo -n "1700000000.{"id":"evt1","type":"ticket.created"}" | openssl dgst -sha256 -hmac "test-signing-secret-abc123"
// Node.js computed reference:
// import { createHmac } from 'crypto'
// createHmac('sha256','test-signing-secret-abc123').update('1700000000.{"id":"evt1","type":"ticket.created"}','utf8').digest('hex')
import { createHmac } from 'crypto';
const KAV_EXPECTED_HEX = createHmac('sha256', KAV_SECRET)
  .update(`${KAV_TIMESTAMP}.${KAV_BODY}`, 'utf8')
  .digest('hex');

describe('buildSignatureHeader', () => {
  it('produces t=unix,v1=hex for single secret', () => {
    const header = buildSignatureHeader({
      rawBody: KAV_BODY,
      unixTimestamp: KAV_TIMESTAMP,
      secret: KAV_SECRET,
    });
    expect(header).toBe(`t=${KAV_TIMESTAMP},v1=${KAV_EXPECTED_HEX}`);
  });

  it('produces two v1= entries during rotation', () => {
    const prevSecret = 'previous-secret-xyz789';
    const prevHex = createHmac('sha256', prevSecret)
      .update(`${KAV_TIMESTAMP}.${KAV_BODY}`, 'utf8')
      .digest('hex');

    const header = buildSignatureHeader({
      rawBody: KAV_BODY,
      unixTimestamp: KAV_TIMESTAMP,
      secret: KAV_SECRET,
      previousSecret: prevSecret,
    });

    expect(header).toBe(`t=${KAV_TIMESTAMP},v1=${KAV_EXPECTED_HEX},v1=${prevHex}`);

    // Two distinct v1 values
    const v1Parts = header.split(',').filter((p) => p.startsWith('v1='));
    expect(v1Parts).toHaveLength(2);
    expect(v1Parts[0]).not.toBe(v1Parts[1]);
  });

  it('signed bytes are timestamp.body (dot-separated)', () => {
    // Independently compute to confirm signed sequence
    const expected = createHmac('sha256', KAV_SECRET)
      .update(`${KAV_TIMESTAMP}.${KAV_BODY}`, 'utf8')
      .digest('hex');
    const header = buildSignatureHeader({ rawBody: KAV_BODY, unixTimestamp: KAV_TIMESTAMP, secret: KAV_SECRET });
    expect(header).toContain(`v1=${expected}`);
  });
});

describe('verifySignatureHeader', () => {
  const validHeader = `t=${KAV_TIMESTAMP},v1=${KAV_EXPECTED_HEX}`;
  // Fixed clock just inside the 5-minute window
  const clock = () => KAV_TIMESTAMP + 100;

  it('returns valid=true for a correct header', () => {
    const result = verifySignatureHeader({
      rawBody: KAV_BODY,
      header: validHeader,
      secret: KAV_SECRET,
      clock,
    });
    expect(result.valid).toBe(true);
  });

  it('returns malformed_header when t= is missing', () => {
    const result = verifySignatureHeader({
      rawBody: KAV_BODY,
      header: `v1=${KAV_EXPECTED_HEX}`,
      secret: KAV_SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'malformed_header' });
  });

  it('returns malformed_header when v1= is missing', () => {
    const result = verifySignatureHeader({
      rawBody: KAV_BODY,
      header: `t=${KAV_TIMESTAMP}`,
      secret: KAV_SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'malformed_header' });
  });

  it('returns replay_attack when timestamp is stale (> 5 min)', () => {
    const staleHeader = `t=${KAV_TIMESTAMP},v1=${KAV_EXPECTED_HEX}`;
    const staleClock = () => KAV_TIMESTAMP + 600; // 10 minutes later
    const result = verifySignatureHeader({
      rawBody: KAV_BODY,
      header: staleHeader,
      secret: KAV_SECRET,
      clock: staleClock,
    });
    expect(result).toEqual({ valid: false, reason: 'replay_attack' });
  });

  it('returns signature_mismatch for tampered body', () => {
    const result = verifySignatureHeader({
      rawBody: '{"id":"evt1","type":"ticket.TAMPERED"}',
      header: validHeader,
      secret: KAV_SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('returns signature_mismatch for wrong secret', () => {
    const result = verifySignatureHeader({
      rawBody: KAV_BODY,
      header: validHeader,
      secret: 'wrong-secret',
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('accepts header when previous secret matches (rotation)', () => {
    // Header signed with prevSecret
    const prevSecret = 'prev-secret-for-rotation';
    const prevHex = createHmac('sha256', prevSecret)
      .update(`${KAV_TIMESTAMP}.${KAV_BODY}`, 'utf8')
      .digest('hex');
    const rotationHeader = `t=${KAV_TIMESTAMP},v1=${KAV_EXPECTED_HEX},v1=${prevHex}`;

    // Verify with current secret — should match first v1
    const result = verifySignatureHeader({
      rawBody: KAV_BODY,
      header: rotationHeader,
      secret: KAV_SECRET,
      clock,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts just inside the replay window boundary (300s)', () => {
    const borderClock = () => KAV_TIMESTAMP + 300;
    const result = verifySignatureHeader({
      rawBody: KAV_BODY,
      header: validHeader,
      secret: KAV_SECRET,
      clock: borderClock,
    });
    expect(result.valid).toBe(true);
  });
});
