/**
 * webhook-url-validator.ts – SSRF control point for webhook destination URLs.
 *
 * Returns { valid: true, resolvedIps } on success.
 * Returns { valid: false, code, message } on rejection.
 *
 * Rules enforced:
 *  1. URL must parse with the WHATWG URL parser.
 *  2. Scheme must be https (not http, ftp, file, etc.).
 *  3. No embedded username or password.
 *  4. Port must be 443 or 8443 (empty port = 443 for https).
 *  5. Hostname must resolve via DNS (A + AAAA).
 *  6. Every resolved IP address must pass the IP deny-list.
 *
 * Deny-listed ranges (RFC1918, loopback, link-local, metadata, IPv6 ULA/link-local):
 *   127.0.0.0/8   – loopback
 *   10.0.0.0/8    – RFC1918
 *   172.16.0.0/12 – RFC1918
 *   192.168.0.0/16 – RFC1918
 *   169.254.0.0/16 – link-local (including 169.254.169.254 AWS metadata)
 *   100.64.0.0/10  – Carrier-grade NAT
 *   192.0.2.0/24   – TEST-NET-1
 *   198.51.100.0/24 – TEST-NET-2
 *   203.0.113.0/24  – TEST-NET-3
 *   0.0.0.0/8       – "This" network
 *   ::1/128         – IPv6 loopback
 *   fc00::/7        – IPv6 ULA (includes fd00::/8)
 *   fe80::/10       – IPv6 link-local
 *
 * This function is a pure validator: it performs no side effects beyond DNS lookup.
 * It is called both at registration and again immediately before each delivery
 * attempt (DNS rebinding defence).
 */

import { promises as dns } from 'dns';

export const WEBHOOK_ERROR_CODES = {
  INVALID_URL:             'WEBHOOK_URL_INVALID',
  NON_HTTPS:               'WEBHOOK_URL_NON_HTTPS',
  EMBEDDED_CREDENTIALS:    'WEBHOOK_URL_EMBEDDED_CREDENTIALS',
  DISALLOWED_PORT:         'WEBHOOK_URL_DISALLOWED_PORT',
  DNS_RESOLUTION_FAILED:   'WEBHOOK_URL_DNS_RESOLUTION_FAILED',
  BLOCKED_PRIVATE_ADDRESS: 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS',
  BLOCKED_IP_LITERAL:      'WEBHOOK_URL_BLOCKED_IP_LITERAL',
} as const;

export type WebhookErrorCode = (typeof WEBHOOK_ERROR_CODES)[keyof typeof WEBHOOK_ERROR_CODES];

export type UrlValidationResult =
  | { valid: true; resolvedIps: string[] }
  | { valid: false; code: WebhookErrorCode; message: string };

const ALLOWED_PORTS = new Set([443, 8443]);

/**
 * Validates a webhook destination URL and resolves its IP addresses.
 * Never returns resolved IPs in error messages to avoid information disclosure.
 */
export async function validateWebhookUrl(rawUrl: string): Promise<UrlValidationResult> {
  // ── Step 1: Parse ─────────────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, code: WEBHOOK_ERROR_CODES.INVALID_URL, message: 'URL is not parseable.' };
  }

  // ── Step 2: Scheme ────────────────────────────────────────────────────────
  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      code: WEBHOOK_ERROR_CODES.NON_HTTPS,
      message: 'Only HTTPS destinations are permitted.',
    };
  }

  // ── Step 3: Embedded credentials ──────────────────────────────────────────
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      code: WEBHOOK_ERROR_CODES.EMBEDDED_CREDENTIALS,
      message: 'URLs must not contain embedded credentials.',
    };
  }

  // ── Step 4: Port ──────────────────────────────────────────────────────────
  const port = parsed.port ? parseInt(parsed.port, 10) : 443;
  if (!ALLOWED_PORTS.has(port)) {
    return {
      valid: false,
      code: WEBHOOK_ERROR_CODES.DISALLOWED_PORT,
      message: `Port ${port} is not permitted. Allowed ports: 443, 8443.`,
    };
  }

  // ── Step 5: IP-literal check (before DNS) ─────────────────────────────────
  const hostname = parsed.hostname;
  const ipLiteralMatch = hostname.match(/^\[(.+)\]$/) ?? null;
  const bareHostname = ipLiteralMatch ? ipLiteralMatch[1] : hostname;

  if (isIpAddress(bareHostname)) {
    if (isBlockedIp(bareHostname)) {
      return {
        valid: false,
        code: WEBHOOK_ERROR_CODES.BLOCKED_IP_LITERAL,
        message: 'IP literal addresses in private, loopback or reserved ranges are not permitted.',
      };
    }
    return { valid: true, resolvedIps: [bareHostname] };
  }

  // ── Step 6: DNS resolution ────────────────────────────────────────────────
  let addresses: string[];
  try {
    const results = await dns.lookup(bareHostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch {
    return {
      valid: false,
      code: WEBHOOK_ERROR_CODES.DNS_RESOLUTION_FAILED,
      message: `Hostname '${bareHostname}' did not resolve. Verify the URL and try again.`,
    };
  }

  if (addresses.length === 0) {
    return {
      valid: false,
      code: WEBHOOK_ERROR_CODES.DNS_RESOLUTION_FAILED,
      message: `Hostname '${bareHostname}' returned no addresses.`,
    };
  }

  // ── Step 7: IP deny-list (all addresses must be public) ───────────────────
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      return {
        valid: false,
        code: WEBHOOK_ERROR_CODES.BLOCKED_PRIVATE_ADDRESS,
        message: `Destination hostname resolves to a private, loopback or reserved address. Check that the URL is reachable from the public internet.`,
      };
    }
  }

  return { valid: true, resolvedIps: addresses };
}

// ── IP range helpers ──────────────────────────────────────────────────────────

function isIpAddress(s: string): boolean {
  return isIpv4(s) || isIpv6(s);
}

function isIpv4(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s);
}

function isIpv6(s: string): boolean {
  return s.includes(':');
}

/** Deny-listed IPv4 and IPv6 ranges. */
function isBlockedIp(ip: string): boolean {
  if (isIpv4(ip)) return isBlockedIpv4(ip);
  if (isIpv6(ip)) return isBlockedIpv6(ip);
  return false;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: string, network: string, prefixLen: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function isBlockedIpv4(ip: string): boolean {
  return (
    inCidr(ip, '0.0.0.0', 8) ||
    inCidr(ip, '10.0.0.0', 8) ||
    inCidr(ip, '100.64.0.0', 10) ||
    inCidr(ip, '127.0.0.0', 8) ||
    inCidr(ip, '169.254.0.0', 16) ||
    inCidr(ip, '172.16.0.0', 12) ||
    inCidr(ip, '192.0.2.0', 24) ||
    inCidr(ip, '192.168.0.0', 16) ||
    inCidr(ip, '198.51.100.0', 24) ||
    inCidr(ip, '203.0.113.0', 24) ||
    inCidr(ip, '240.0.0.0', 4)
  );
}

function isBlockedIpv6(ip: string): boolean {
  const expanded = expandIpv6(ip.toLowerCase());
  if (!expanded) return false;

  // ::1/128 loopback
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return true;

  const prefix7 = parseInt(expanded.replace(/:/g, '').substring(0, 2), 16);
  // fc00::/7 – ULA (covers fc00:: and fd00::)
  if ((prefix7 & 0xfe) === 0xfc) return true;

  const prefix10 = parseInt(expanded.replace(/:/g, '').substring(0, 3), 16);
  // fe80::/10 – link-local
  if ((prefix10 & 0xffc) === 0xfe8) return true;

  return false;
}

/**
 * Expands a compressed IPv6 address to full 8-group form.
 * Returns null if the address cannot be expanded (invalid).
 */
function expandIpv6(ip: string): string | null {
  try {
    // Handle ::
    const parts = ip.split('::');
    if (parts.length > 2) return null;

    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill('0000');
    const all = [...left, ...middle, ...right];
    if (all.length !== 8) return null;
    return all.map((g) => g.padStart(4, '0')).join(':');
  } catch {
    return null;
  }
}
