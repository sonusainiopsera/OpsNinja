/**
 * URL fixture table for use in test suites.
 *
 * Each entry is { url, expectValid, expectedCode?, label }.
 * The "malicious" entries cover the SSRF attack surface.
 */

import { WEBHOOK_ERROR_CODES } from '../../webhook-url-validator';

export interface UrlFixture {
  label: string;
  url: string;
  expectValid: boolean;
  expectedCode?: string;
  stubResolvedIp?: string;
}

export const URL_FIXTURES: UrlFixture[] = [
  // ── Valid URLs ───────────────────────────────────────────────────────────
  {
    label: 'valid https 443',
    url: 'https://hooks.example.com/webhook',
    expectValid: true,
    stubResolvedIp: '203.0.114.1',
  },
  {
    label: 'valid https 8443',
    url: 'https://hooks.example.com:8443/webhook',
    expectValid: true,
    stubResolvedIp: '203.0.114.1',
  },

  // ── Non-HTTPS schemes ────────────────────────────────────────────────────
  {
    label: 'http scheme rejected',
    url: 'http://hooks.example.com/webhook',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.NON_HTTPS,
  },
  {
    label: 'ftp scheme rejected',
    url: 'ftp://hooks.example.com',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.NON_HTTPS,
  },
  {
    label: 'file scheme rejected',
    url: 'file:///etc/passwd',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.NON_HTTPS,
  },

  // ── Embedded credentials ─────────────────────────────────────────────────
  {
    label: 'url with username rejected',
    url: 'https://attacker@example.com',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.EMBEDDED_CREDENTIALS,
  },
  {
    label: 'url with password rejected',
    url: 'https://user:secret@example.com',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.EMBEDDED_CREDENTIALS,
  },

  // ── Disallowed ports ─────────────────────────────────────────────────────
  {
    label: 'port 22 (SSH) rejected',
    url: 'https://example.com:22/hook',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.DISALLOWED_PORT,
  },
  {
    label: 'port 80 (HTTP) rejected',
    url: 'https://example.com:80/hook',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.DISALLOWED_PORT,
  },
  {
    label: 'port 8080 rejected',
    url: 'https://example.com:8080/hook',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.DISALLOWED_PORT,
  },

  // ── IP literals ──────────────────────────────────────────────────────────
  {
    label: 'AWS metadata IP literal rejected',
    url: 'https://169.254.169.254/latest/meta-data/',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.BLOCKED_IP_LITERAL,
  },
  {
    label: 'loopback IP literal rejected',
    url: 'https://127.0.0.1/',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.BLOCKED_IP_LITERAL,
  },
  {
    label: 'RFC1918 IP literal rejected',
    url: 'https://192.168.1.100/',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.BLOCKED_IP_LITERAL,
  },

  // ── Hostname resolving to private IP ────────────────────────────────────
  {
    label: 'hostname resolving to AWS metadata rejected',
    url: 'https://metadata.internal/',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.BLOCKED_PRIVATE_ADDRESS,
    stubResolvedIp: '169.254.169.254',
  },
  {
    label: 'hostname resolving to RFC1918 rejected',
    url: 'https://internal-service.example.com/',
    expectValid: false,
    expectedCode: WEBHOOK_ERROR_CODES.BLOCKED_PRIVATE_ADDRESS,
    stubResolvedIp: '10.0.1.50',
  },
];
