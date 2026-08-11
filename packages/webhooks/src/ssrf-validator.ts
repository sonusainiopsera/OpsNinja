/**
 * SSRF validator — re-exported from the API module for shared use.
 *
 * This module re-exports the validateWebhookUrl function so both the
 * API management plane (WO-083) and the delivery worker (WO-084) use
 * identical SSRF validation logic without duplication.
 *
 * The canonical implementation lives in packages/webhooks/src/ssrf-validator.ts.
 * The API module's webhook-url-validator.ts delegates to this module.
 */

import { promises as dns } from 'dns';

const ALLOWED_PORTS = new Set([443, 8443]);

// Private CIDR ranges to block
const PRIVATE_RANGES: Array<{ prefix: number[]; bits: number }> = [
  { prefix: [127], bits: 8 },           // 127.0.0.0/8 loopback
  { prefix: [10], bits: 8 },             // 10.0.0.0/8 RFC1918
  { prefix: [172, 16], bits: 12 },       // 172.16.0.0/12 RFC1918
  { prefix: [192, 168], bits: 16 },      // 192.168.0.0/16 RFC1918
  { prefix: [169, 254], bits: 16 },      // 169.254.0.0/16 link-local
];

export interface UrlValidationResult {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
  resolvedAddresses?: string[];
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;

  for (const range of PRIVATE_RANGES) {
    const { prefix, bits } = range;
    const maskBytes = Math.floor(bits / 8);
    if (prefix.every((b, i) => parts[i] === b)) return true;
    // Handle partial byte masks (e.g. /12 for 172.16.0.0)
    if (
      bits % 8 !== 0 &&
      prefix.length <= maskBytes + 1 &&
      prefix.slice(0, maskBytes).every((b, i) => parts[i] === b)
    ) {
      const partialMask = 0xff & (0xff << (8 - (bits % 8)));
      if ((parts[maskBytes] & partialMask) === (prefix[maskBytes] & partialMask)) return true;
    }
  }
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8');
}

export async function validateWebhookUrl(url: string): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, errorCode: 'INVALID_URL', errorMessage: 'URL could not be parsed' };
  }

  if (parsed.protocol !== 'https:') {
    return { allowed: false, errorCode: 'NON_HTTPS', errorMessage: 'Only https:// URLs are allowed' };
  }

  if (parsed.username || parsed.password) {
    return { allowed: false, errorCode: 'CREDENTIALS_IN_URL', errorMessage: 'URLs must not contain credentials' };
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : 443;
  if (!ALLOWED_PORTS.has(port)) {
    return { allowed: false, errorCode: 'DISALLOWED_PORT', errorMessage: `Port ${port} is not allowed` };
  }

  const hostname = parsed.hostname;

  // Resolve hostname
  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true });
    addresses = records.map((r) => r.address);
  } catch {
    return { allowed: false, errorCode: 'DNS_RESOLUTION_FAILED', errorMessage: 'Hostname could not be resolved' };
  }

  for (const addr of addresses) {
    if (isPrivateIpv4(addr) || isPrivateIpv6(addr)) {
      return { allowed: false, errorCode: 'SSRF_BLOCKED', errorMessage: 'Resolved address is in a private range' };
    }
  }

  return { allowed: true, resolvedAddresses: addresses };
}
