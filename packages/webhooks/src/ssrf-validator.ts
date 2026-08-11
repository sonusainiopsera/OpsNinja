/**
 * ssrf-validator.ts – re-exports the SSRF validation from the API module.
 *
 * The webhook-dispatcher calls this at delivery time (DNS rebinding defence).
 * At worker runtime this module delegates to the same DNS resolver and deny-list
 * logic used at registration time.
 *
 * Because the API's validateWebhookUrl lives in apps/api (not in a shared package),
 * we re-implement the same validation logic here so the packages/webhooks package
 * has no dependency on apps/api.
 */

import { promises as dns } from 'dns';

export type SsrfValidationResult =
  | { valid: true; resolvedIps: string[] }
  | { valid: false; code: string; message: string };

const ALLOWED_PORTS = new Set([443, 8443]);

export async function validateWebhookUrl(rawUrl: string): Promise<SsrfValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, code: 'SSRF_INVALID_URL', message: 'URL is not parseable.' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, code: 'SSRF_NON_HTTPS', message: 'Only HTTPS is permitted.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, code: 'SSRF_CREDENTIALS', message: 'Embedded credentials are not permitted.' };
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : 443;
  if (!ALLOWED_PORTS.has(port)) {
    return { valid: false, code: 'SSRF_DISALLOWED_PORT', message: `Port ${port} is not permitted.` };
  }

  const hostname = parsed.hostname.replace(/^\[(.+)\]$/, '$1');

  if (isIpAddress(hostname)) {
    if (isBlockedIp(hostname)) {
      return { valid: false, code: 'SSRF_BLOCKED_IP', message: 'IP address is in a blocked range.' };
    }
    return { valid: true, resolvedIps: [hostname] };
  }

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch {
    return { valid: false, code: 'SSRF_DNS_FAILURE', message: 'DNS resolution failed.' };
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      return { valid: false, code: 'SSRF_BLOCKED_PRIVATE', message: 'Destination resolves to a private address.' };
    }
  }

  return { valid: true, resolvedIps: addresses };
}

function isIpAddress(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || s.includes(':');
}

function isBlockedIp(ip: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return isBlockedIpv4(ip);
  if (ip.includes(':')) return isBlockedIpv6(ip);
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
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  const prefix7 = parseInt(expanded.replace(/:/g, '').substring(0, 2), 16);
  if ((prefix7 & 0xfe) === 0xfc) return true;
  const prefix10 = parseInt(expanded.replace(/:/g, '').substring(0, 3), 16);
  if ((prefix10 & 0xffc) === 0xfe8) return true;
  return false;
}

function expandIpv6(ip: string): string | null {
  try {
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
