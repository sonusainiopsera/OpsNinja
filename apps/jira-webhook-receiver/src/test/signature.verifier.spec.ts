/**
 * Unit tests for verifyJiraWebhookSignature — WO-054.
 *
 * Covers:
 *  - Valid signature accepted
 *  - Missing header rejected
 *  - Malformed header (no sha256= prefix, wrong hex length) rejected
 *  - Tampered body rejected
 *  - Timestamp just inside the 5-minute window accepted
 *  - Timestamp just outside the 5-minute window rejected (STALE_SIGNATURE)
 *  - Previous secret accepted during rotation overlap
 *  - Wrong secret rejected
 */

import { verifyJiraWebhookSignature, buildJiraWebhookHeaders } from '../signature.verifier';

const NOW = 1712300000; // fixed Unix second for deterministic tests
const clock = () => NOW;
const SECRET = 'whs_test_secret_32bytes_padding00';
const PREV_SECRET = 'whs_prev_secret_32bytes_padding00';
const BODY = Buffer.from('{"webhookEvent":"jira:issue_updated","id":100001}');

function makeHeaders(body: Buffer, secret: string, ts: number = NOW) {
  return buildJiraWebhookHeaders(body, secret, ts);
}

describe('verifyJiraWebhookSignature', () => {
  it('accepts a valid signature', () => {
    const h = makeHeaders(BODY, SECRET);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      clock,
    });
    expect(result).toEqual({ valid: true });
  });

  it('rejects when X-Hub-Signature is missing', () => {
    const h = makeHeaders(BODY, SECRET);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: undefined,
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'missing_header' });
  });

  it('rejects when X-OpsNinja-Timestamp is missing', () => {
    const h = makeHeaders(BODY, SECRET);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: undefined,
      secret: SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'missing_header' });
  });

  it('rejects a non-integer timestamp', () => {
    const h = makeHeaders(BODY, SECRET);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: 'not-a-number',
      secret: SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'malformed_header' });
  });

  it('rejects a header without sha256= prefix', () => {
    const h = makeHeaders(BODY, SECRET);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'].replace('sha256=', 'md5='),
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'malformed_header' });
  });

  it('rejects a hex value with wrong length', () => {
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: 'sha256=tooshort',
      timestampHeader: String(NOW),
      secret: SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'malformed_header' });
  });

  it('rejects a tampered body', () => {
    const h = makeHeaders(BODY, SECRET);
    const tampered = Buffer.from('{"webhookEvent":"tampered","id":999}');
    const result = verifyJiraWebhookSignature({
      rawBody: tampered,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('accepts a timestamp exactly at the tolerance boundary (299s)', () => {
    const h = makeHeaders(BODY, SECRET, NOW - 299);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      toleranceSeconds: 300,
      clock,
    });
    expect(result).toEqual({ valid: true });
  });

  it('rejects a timestamp just outside the 5-minute window (301s)', () => {
    const h = makeHeaders(BODY, SECRET, NOW - 301);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      toleranceSeconds: 300,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'stale_signature' });
  });

  it('accepts a future timestamp within tolerance (signed by Jira, clock skew)', () => {
    const h = makeHeaders(BODY, SECRET, NOW + 60);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      toleranceSeconds: 300,
      clock,
    });
    expect(result).toEqual({ valid: true });
  });

  it('accepts the previous secret during rotation overlap window', () => {
    const h = makeHeaders(BODY, PREV_SECRET);
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      previousSecret: PREV_SECRET,
      clock,
    });
    expect(result).toEqual({ valid: true });
  });

  it('rejects a completely wrong secret', () => {
    const h = makeHeaders(BODY, 'wrong_secret_entirely_different_00');
    const result = verifyJiraWebhookSignature({
      rawBody: BODY,
      hubSignatureHeader: h['X-Hub-Signature'],
      timestampHeader: h['X-OpsNinja-Timestamp'],
      secret: SECRET,
      clock,
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });
});
