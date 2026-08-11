/**
 * Table-driven unit tests for webhook-url-validator.
 *
 * DNS is mocked at the module level so no real resolution happens.
 */

import { jest } from '@jest/globals';

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

import { promises as dns } from 'dns';
import { validateWebhookUrl, WEBHOOK_ERROR_CODES } from '../webhook-url-validator';

const mockLookup = dns.lookup as jest.MockedFunction<typeof dns.lookup>;

beforeEach(() => {
  jest.clearAllMocks();
});

function stubResolve(...ips: string[]) {
  mockLookup.mockResolvedValue(ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as never);
}

describe('webhook-url-validator', () => {
  describe('scheme enforcement', () => {
    it('rejects http://', async () => {
      const r = await validateWebhookUrl('http://example.com');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.NON_HTTPS);
    });

    it('rejects ftp://', async () => {
      const r = await validateWebhookUrl('ftp://example.com');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.NON_HTTPS);
    });

    it('rejects file://', async () => {
      const r = await validateWebhookUrl('file:///etc/passwd');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.NON_HTTPS);
    });
  });

  describe('credential rejection', () => {
    it('rejects URL with username', async () => {
      const r = await validateWebhookUrl('https://user@example.com');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.EMBEDDED_CREDENTIALS);
    });

    it('rejects URL with password', async () => {
      const r = await validateWebhookUrl('https://user:pass@example.com');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.EMBEDDED_CREDENTIALS);
    });
  });

  describe('port allow-list', () => {
    it('accepts default port (443)', async () => {
      stubResolve('93.184.216.34');
      const r = await validateWebhookUrl('https://example.com/hook');
      expect(r.valid).toBe(true);
    });

    it('accepts explicit 443', async () => {
      stubResolve('93.184.216.34');
      const r = await validateWebhookUrl('https://example.com:443/hook');
      expect(r.valid).toBe(true);
    });

    it('accepts port 8443', async () => {
      stubResolve('93.184.216.34');
      const r = await validateWebhookUrl('https://example.com:8443/hook');
      expect(r.valid).toBe(true);
    });

    it('rejects port 22', async () => {
      const r = await validateWebhookUrl('https://example.com:22/hook');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.DISALLOWED_PORT);
    });

    it('rejects port 8080', async () => {
      const r = await validateWebhookUrl('https://example.com:8080/hook');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.DISALLOWED_PORT);
    });
  });

  describe('DNS resolution failures', () => {
    it('rejects unresolvable hostnames', async () => {
      mockLookup.mockRejectedValue(new Error('ENOTFOUND') as never);
      const r = await validateWebhookUrl('https://nonexistent.invalid/hook');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.DNS_RESOLUTION_FAILED);
    });
  });

  describe('CIDR deny-list (IPv4)', () => {
    const blockedCases: Array<[string, string]> = [
      ['127.0.0.1', 'loopback'],
      ['127.0.0.100', 'loopback range'],
      ['10.0.0.1', 'RFC1918 10/8'],
      ['10.255.255.255', 'RFC1918 10/8 end'],
      ['172.16.0.1', 'RFC1918 172.16/12'],
      ['172.31.255.255', 'RFC1918 172.16/12 end'],
      ['192.168.0.1', 'RFC1918 192.168/16'],
      ['192.168.255.255', 'RFC1918 192.168/16 end'],
      ['169.254.0.1', 'link-local'],
      ['169.254.169.254', 'AWS metadata endpoint'],
      ['100.64.0.1', 'CGNAT'],
      ['0.0.0.1', '"This" network'],
    ];

    it.each(blockedCases)('rejects %s (%s)', async (ip) => {
      stubResolve(ip);
      const r = await validateWebhookUrl('https://hooks.example.com');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.BLOCKED_PRIVATE_ADDRESS);
    });
  });

  describe('CIDR deny-list (IPv6)', () => {
    const blockedIpv6: Array<[string, string]> = [
      ['::1', 'IPv6 loopback'],
      ['fc00::1', 'ULA fc00::/7'],
      ['fd00::1', 'ULA fd00::/8 (inside fc00::/7)'],
      ['fe80::1', 'IPv6 link-local'],
    ];

    it.each(blockedIpv6)('rejects %s (%s)', async (ip) => {
      stubResolve(ip);
      const r = await validateWebhookUrl('https://hooks.example.com');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.BLOCKED_PRIVATE_ADDRESS);
    });
  });

  describe('IP literal rejection', () => {
    it('rejects https://169.254.169.254/ without DNS lookup', async () => {
      const r = await validateWebhookUrl('https://169.254.169.254/latest/meta-data/');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.BLOCKED_IP_LITERAL);
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects https://127.0.0.1/ without DNS lookup', async () => {
      const r = await validateWebhookUrl('https://127.0.0.1/');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.BLOCKED_IP_LITERAL);
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  describe('multi-address: any private address blocks the whole URL', () => {
    it('rejects when one address is private and another is public', async () => {
      stubResolve('93.184.216.34', '10.0.0.1');
      const r = await validateWebhookUrl('https://hooks.example.com');
      expect(r.valid).toBe(false);
      expect((r as { code: string }).code).toBe(WEBHOOK_ERROR_CODES.BLOCKED_PRIVATE_ADDRESS);
    });
  });

  describe('valid cases', () => {
    it('accepts a public https URL', async () => {
      stubResolve('93.184.216.34');
      const r = await validateWebhookUrl('https://hooks.example.com/incoming');
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.resolvedIps).toEqual(['93.184.216.34']);
      }
    });

    it('returns all resolved addresses on success', async () => {
      stubResolve('203.0.114.1', '203.0.114.2');
      const r = await validateWebhookUrl('https://multi.example.com');
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.resolvedIps).toHaveLength(2);
      }
    });
  });
});
