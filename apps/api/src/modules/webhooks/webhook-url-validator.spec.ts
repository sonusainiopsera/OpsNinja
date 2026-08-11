/**
 * Table-driven SSRF unit tests for webhook-url-validator.
 *
 * dns.promises.lookup is mocked — no real DNS queries.
 */

import { validateWebhookUrl } from './webhook-url-validator';

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

import { promises as dns } from 'dns';
const mockLookup = dns.lookup as jest.Mock;

function stubDns(addresses: Array<{ address: string; family: number }>) {
  mockLookup.mockResolvedValue(addresses);
}

function stubDnsFail() {
  mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
}

describe('validateWebhookUrl', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Valid URLs ──────────────────────────────────────────────────────────────
  it('allows a valid https URL on port 443', async () => {
    stubDns([{ address: '93.184.216.34', family: 4 }]);
    const r = await validateWebhookUrl('https://example.com/hooks/ticket');
    expect(r.allowed).toBe(true);
    expect(r.resolvedAddresses).toContain('93.184.216.34');
  });

  it('allows port 8443', async () => {
    stubDns([{ address: '93.184.216.34', family: 4 }]);
    const r = await validateWebhookUrl('https://example.com:8443/hook');
    expect(r.allowed).toBe(true);
  });

  // ── Scheme rejections ───────────────────────────────────────────────────────
  it.each([
    ['http://example.com/hook', 'WEBHOOK_URL_NOT_HTTPS'],
    ['ftp://example.com/hook', 'WEBHOOK_URL_NOT_HTTPS'],
    ['file:///etc/passwd', 'WEBHOOK_URL_NOT_HTTPS'],
    ['javascript:alert(1)', 'WEBHOOK_URL_NOT_HTTPS'],
  ])('rejects scheme: %s → %s', async (url, expectedCode) => {
    const r = await validateWebhookUrl(url);
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe(expectedCode);
  });

  // ── Embedded credentials ────────────────────────────────────────────────────
  it('rejects URL with embedded username and password', async () => {
    const r = await validateWebhookUrl('https://user:pass@example.com/hook');
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_EMBEDDED_CREDENTIALS');
  });

  // ── Disallowed ports ────────────────────────────────────────────────────────
  it.each([
    'https://example.com:22/hook',
    'https://example.com:80/hook',
    'https://example.com:8080/hook',
    'https://example.com:3000/hook',
  ])('rejects disallowed port: %s', async (url) => {
    const r = await validateWebhookUrl(url);
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_DISALLOWED_PORT');
  });

  // ── DNS failure ─────────────────────────────────────────────────────────────
  it('rejects unresolvable hostname', async () => {
    stubDnsFail();
    const r = await validateWebhookUrl('https://nonexistent.invalid/hook');
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_DNS_RESOLUTION_FAILED');
  });

  // ── IPv4 deny-list ─────────────────────────────────────────────────────────
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback top'],
    ['10.0.0.1', 'RFC1918 10/8'],
    ['10.255.255.255', 'RFC1918 10/8 top'],
    ['172.16.0.1', 'RFC1918 172.16/12'],
    ['172.31.255.255', 'RFC1918 172.16/12 top'],
    ['192.168.0.1', 'RFC1918 192.168/16'],
    ['192.168.255.255', 'RFC1918 192.168/16 top'],
    ['169.254.0.1', 'link-local'],
    ['169.254.169.254', 'cloud metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
  ])('rejects IPv4 %s (%s) via DNS stub', async (ip, _label) => {
    stubDns([{ address: ip, family: 4 }]);
    const r = await validateWebhookUrl('https://internal.example.com/hook');
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS');
  });

  it('rejects IPv4 literal 10.0.0.1 (no DNS lookup)', async () => {
    const r = await validateWebhookUrl('https://10.0.0.1/hook');
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects IPv4 cloud metadata literal 169.254.169.254', async () => {
    const r = await validateWebhookUrl('https://169.254.169.254/latest/meta-data');
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS');
  });

  // ── IPv6 deny-list ─────────────────────────────────────────────────────────
  it.each([
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'IPv6 ULA fc00::/7'],
    ['fd00::1', 'IPv6 ULA fd00::/7'],
    ['fe80::1', 'IPv6 link-local'],
  ])('rejects IPv6 %s (%s) via DNS stub', async (ip, _label) => {
    stubDns([{ address: ip, family: 6 }]);
    const r = await validateWebhookUrl('https://internal6.example.com/hook');
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS');
  });

  it('rejects IPv6 loopback literal [::1]', async () => {
    const r = await validateWebhookUrl('https://[::1]/hook');
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  // ── Multi-address — any private blocks the whole request ───────────────────
  it('rejects when one address is private even if others are public', async () => {
    stubDns([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    const r = await validateWebhookUrl('https://multi.example.com/hook');
    expect(r.allowed).toBe(false);
    expect(r.errorCode).toBe('WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS');
  });
});
