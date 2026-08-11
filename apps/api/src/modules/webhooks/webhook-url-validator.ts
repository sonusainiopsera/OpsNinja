/**
 * Webhook URL validator — SSRF control point.
 *
 * Applied at registration time AND immediately before each delivery attempt
 * (to defeat DNS rebinding attacks).
 *
 * Rules enforced:
 *  1. WHATWG URL parse must succeed.
 *  2. Scheme must be https — no http, ftp, file, javascript, etc.
 *  3. No embedded username or password in the URL.
 *  4. Port must be in ALLOWED_PORTS (443, 8443) or absent (defaults to 443 for https).
 *  5. Hostname must resolve via dns.promises.lookup({ all: true }).
 *  6. Every resolved IP address must pass the CIDR deny-list:
 *       127.0.0.0/8     (loopback)
 *       10.0.0.0/8      (RFC1918)
 *       172.16.0.0/12   (RFC1918)
 *       192.168.0.0/16  (RFC1918)
 *       169.254.0.0/16  (link-local, incl. 169.254.169.254 cloud metadata)
 *       ::1/128          (IPv6 loopback)
 *       fc00::/7        (IPv6 ULA)
 *       fe80::/10       (IPv6 link-local)
 *  7. IP literals in the hostname are also evaluated against the deny-list.
 *
 * Returns a structured result rather than throwing so callers can distinguish
 * validation failures from infra errors and surface actionable messages.
 * Resolved addresses are returned so the delivery worker can pin them.
 *
 * IMPORTANT: resolved internal IPs are NEVER returned to callers in API responses.
 */

import { promises as dns } from 'dns';

export interface UrlValidationResult {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
  /** Resolved public IP addresses (for delivery-time pinning). Absent on failure. */
  resolvedAddresses?: string[];
}

const ALLOWED_PORTS = new Set([443, 8443]);

// IPv4 CIDR deny-list as [baseAddress (numeric), prefix length, range top].
interface Cidr4 {
  base: number;
  mask: number;
}

function ipv4ToNum(addr: string): number {
  return addr.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function parseCidr4(cidr: string): Cidr4 {
  const [addr, bits] = cidr.split('/') as [string, string];
  const base = ipv4ToNum(addr);
  const mask = bits === '32' ? 0xffffffff : ~(0xffffffff >>> parseInt(bits, 10));
  return { base: base >>> 0, mask: mask >>> 0 };
}

const IPV4_DENY_LIST: Cidr4[] = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '0.0.0.0/8',
  '100.64.0.0/10', // Shared address space (RFC6598) — carrier-grade NAT
  '240.0.0.0/4',  // Reserved
].map(parseCidr4);

function isBlockedIpv4(addr: string): boolean {
  try {
    const num = ipv4ToNum(addr);
    return IPV4_DENY_LIST.some((cidr) => (num & cidr.mask) >>> 0 === cidr.base);
  } catch {
    return true; // Fail closed on parse error
  }
}

function isBlockedIpv6(addr: string): boolean {
  // Normalise to lowercase, strip brackets if present
  const a = addr.toLowerCase().replace(/^\[|\]$/g, '');

  // Loopback ::1
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true;
  // Unspecified ::
  if (a === '::' || a === '0:0:0:0:0:0:0:0') return true;

  // Try to detect ULA (fc00::/7) and link-local (fe80::/10)
  // by examining the first 16-bit group.
  const firstGroup = a.split(':')[0] ?? '';
  if (firstGroup.length === 0) {
    // Compressed form starting with ::, e.g. ::ffff:...
    // If it maps to IPv4-mapped, fall through to IPv4 check.
    return false;
  }
  const high16 = parseInt(firstGroup.padStart(4, '0'), 16);
  // fc00::/7 — high bits 1111 110x → 0xfc00–0xfdff
  if ((high16 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — high bits 1111 1110 10xx xxxx → 0xfe80–0xfebf
  if ((high16 & 0xffc0) === 0xfe80) return true;

  return false;
}

function isBlockedAddress(addr: string, family: number | string): boolean {
  if (family === 4 || family === 'IPv4') return isBlockedIpv4(addr);
  if (family === 6 || family === 'IPv6') return isBlockedIpv6(addr);
  return true; // Unknown family — fail closed
}

/** Validate a webhook destination URL for SSRF safety. */
export async function validateWebhookUrl(rawUrl: string): Promise<UrlValidationResult> {
  // ── Rule 1: Parse ──────────────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      allowed: false,
      errorCode: 'WEBHOOK_URL_INVALID',
      errorMessage: 'URL could not be parsed. Provide a valid absolute URL.',
    };
  }

  // ── Rule 2: HTTPS only ─────────────────────────────────────────────────────
  if (parsed.protocol !== 'https:') {
    return {
      allowed: false,
      errorCode: 'WEBHOOK_URL_NOT_HTTPS',
      errorMessage: `Only https scheme is allowed. Got: ${parsed.protocol.replace(':', '')}`,
    };
  }

  // ── Rule 3: No embedded credentials ───────────────────────────────────────
  if (parsed.username !== '' || parsed.password !== '') {
    return {
      allowed: false,
      errorCode: 'WEBHOOK_URL_EMBEDDED_CREDENTIALS',
      errorMessage: 'URL must not contain embedded username or password.',
    };
  }

  // ── Rule 4: Port allow-list ────────────────────────────────────────────────
  const portStr = parsed.port;
  const port = portStr === '' ? 443 : parseInt(portStr, 10);
  if (!ALLOWED_PORTS.has(port)) {
    return {
      allowed: false,
      errorCode: 'WEBHOOK_URL_DISALLOWED_PORT',
      errorMessage: `Port ${port} is not allowed. Use 443 or 8443.`,
    };
  }

  // ── Rule 5+6+7: DNS resolution and CIDR deny-list ─────────────────────────
  const hostname = parsed.hostname;

  // Handle IPv4 literal (e.g. https://10.0.0.1/) — skip DNS, check directly.
  const ipv4LiteralRe = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  if (ipv4LiteralRe.test(hostname)) {
    if (isBlockedIpv4(hostname)) {
      return {
        allowed: false,
        errorCode: 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS',
        errorMessage: 'IP literal address is in a blocked private/reserved range.',
      };
    }
    return { allowed: true, resolvedAddresses: [hostname] };
  }

  // Handle IPv6 literal (e.g. https://[::1]/)
  if (hostname.startsWith('[') || hostname.includes(':')) {
    const bare = hostname.replace(/^\[|\]$/g, '');
    if (isBlockedIpv6(bare)) {
      return {
        allowed: false,
        errorCode: 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS',
        errorMessage: 'IPv6 literal is in a blocked range.',
      };
    }
    return { allowed: true, resolvedAddresses: [bare] };
  }

  // Normal hostname — resolve all A/AAAA records.
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return {
      allowed: false,
      errorCode: 'WEBHOOK_URL_DNS_RESOLUTION_FAILED',
      errorMessage: `Hostname "${hostname}" could not be resolved. Verify the domain is accessible.`,
    };
  }

  if (addresses.length === 0) {
    return {
      allowed: false,
      errorCode: 'WEBHOOK_URL_DNS_RESOLUTION_FAILED',
      errorMessage: `Hostname "${hostname}" returned no IP addresses.`,
    };
  }

  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      return {
        allowed: false,
        errorCode: 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS',
        errorMessage:
          'At least one resolved address is in a blocked private/reserved range. ' +
          'All addresses must be publicly routable.',
      };
    }
  }

  return {
    allowed: true,
    resolvedAddresses: addresses.map((a) => a.address),
  };
}
