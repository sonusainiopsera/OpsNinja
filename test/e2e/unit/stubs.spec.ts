/**
 * Unit tests for E2E stub helpers.
 *
 * Tests:
 *   - InferenceStub returns fixed summary in success mode
 *   - InferenceStub returns 500 in forced_failure mode
 *   - MailCaptureStub captures POSTed messages
 *   - MailCaptureStub.waitForMessage resolves when message arrives
 *   - MailCaptureStub.waitForMessage rejects on timeout
 *   - JiraStub records POST requests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InferenceStub, FIXED_SUMMARY } from '../support/stubs/inference-stub';
import { MailCaptureStub } from '../support/stubs/mail-capture';

// Use unique ports per test file to avoid conflicts when running in parallel
const INFERENCE_PORT = 29101;
const MAIL_PORT = 29102;

describe('InferenceStub', () => {
  let stub: InferenceStub;

  beforeEach(async () => {
    stub = new InferenceStub({ port: INFERENCE_PORT });
    await stub.start();
  });

  afterEach(async () => {
    await stub.stop();
  });

  it('returns fixed summary in success mode', async () => {
    const res = await fetch(`${stub.baseUrl}/v1/synthesize`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(FIXED_SUMMARY);
  });

  it('returns 500 in forced_failure mode', async () => {
    stub.setFailureMode();
    const res = await fetch(`${stub.baseUrl}/v1/synthesize`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(500);
  });

  it('recovers to success mode after setSuccessMode()', async () => {
    stub.setFailureMode();
    stub.setSuccessMode();
    const res = await fetch(`${stub.baseUrl}/v1/synthesize`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
  });
});

describe('MailCaptureStub', () => {
  let stub: MailCaptureStub;

  beforeEach(async () => {
    stub = new MailCaptureStub(MAIL_PORT);
    await stub.start();
  });

  afterEach(async () => {
    await stub.stop();
  });

  it('captures POSTed messages', async () => {
    const res = await fetch(`${stub.baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'test@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }),
    });
    expect(res.status).toBe(200);
    expect(stub.messages).toHaveLength(1);
    expect(stub.messages[0]!.to).toBe('test@example.com');
  });

  it('clear() empties the message store', async () => {
    await fetch(`${stub.baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.com', subject: 'X', html: '', text: '' }),
    });
    stub.clear();
    expect(stub.messages).toHaveLength(0);
  });

  it('waitForMessage resolves when message arrives', async () => {
    // Post message asynchronously
    setTimeout(() => {
      fetch(`${stub.baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'async@example.com', subject: 'Async', html: '', text: '', templateKey: 'csat_survey' }),
      });
    }, 100);

    const msg = await stub.waitForMessage((m) => m.templateKey === 'csat_survey', 3_000);
    expect(msg.templateKey).toBe('csat_survey');
  });

  it('waitForMessage rejects on timeout', async () => {
    await expect(
      stub.waitForMessage(() => false, 200),
    ).rejects.toThrow('200ms');
  });

  it('extractLink returns link from html body', () => {
    const msg = {
      to: 'a@b.com',
      subject: 'Survey',
      html: '<a href="https://example.com/csat/tok123">Take survey</a>',
      text: '',
      timestamp: Date.now(),
    };
    const link = stub.extractLink(msg, /href="([^"]+csat[^"]+)"/);
    expect(link).toBe('https://example.com/csat/tok123');
  });
});
