/**
 * Deterministic anonymiser — produces pseudonymous replacements for PII fields.
 *
 * Properties:
 *   - Same source value always maps to the same pseudonym within a run
 *     (referential integrity across tables — contact email and requester must
 *     anonymise consistently so FK relations and RLS tests remain meaningful).
 *   - Backed by SeededRandom (Mulberry32) so output is reproducible from seed.
 *   - IRREVERSIBLE — uses a one-way hash to derive the PRNG seed, not
 *     encryption. There is no decryption path.
 *   - Safe for non-production datasets only. Never use against production data.
 *
 * Usage:
 *   const anon = new Anonymizer({ seed: 42 });
 *   anon.email('alice@acme.com')    // → stable fake email
 *   anon.fullName('Alice Smith')    // → stable fake name
 *   anon.ipv4('203.0.113.1')        // → '198.51.100.X' (TEST-NET-2)
 *   anon.freeText('Call me at ...')  // → '[ANONYMISED_TEXT]'
 */

import { createHash } from 'crypto';

// SeededRandom is from @opsninja/test-seed but we inline the Mulberry32 PRNG
// here to avoid a circular dependency between observability and test-seed.
class Mulberry32 {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let z = this.s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  }
  nextInt(max: number): number { return Math.floor(this.next() * max); }
  pick<T>(arr: readonly T[]): T { return arr[this.nextInt(arr.length)]!; }
}

// ---------------------------------------------------------------------------
// Corpus for realistic-looking pseudonyms
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Alex', 'Blair', 'Casey', 'Dana', 'Emery', 'Finley', 'Grey', 'Harper',
  'Indigo', 'Jordan', 'Kendall', 'Lake', 'Morgan', 'Nova', 'Oakley', 'Perry',
  'Quinn', 'River', 'Sage', 'Taylor', 'Uma', 'Vale', 'Winter', 'Xen',
  'Yael', 'Zion',
];

const LAST_NAMES = [
  'Anderson', 'Baker', 'Carter', 'Davis', 'Evans', 'Fisher', 'Grant',
  'Harris', 'Irving', 'Jones', 'King', 'Lewis', 'Moore', 'Nash', 'Owen',
  'Park', 'Quinn', 'Reed', 'Stone', 'Taylor', 'Upton', 'Vance', 'Walsh',
  'Xu', 'Young', 'Zhang',
];

// RFC5737 TEST-NET domains (safe for docs/testing)
const TEST_EMAIL_DOMAINS = [
  'example.com', 'example.org', 'example.net',
  'test.invalid', 'nonprod.invalid',
];

// RFC5737 TEST-NET IP prefixes
const TEST_IP_PREFIXES = ['192.0.2', '198.51.100', '203.0.113'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a deterministic seed from an arbitrary string value. */
function valueSeed(value: string, globalSeed: number): number {
  const hash = createHash('sha256').update(String(globalSeed)).update(value).digest();
  // Use first 4 bytes as unsigned 32-bit int
  return ((hash[0]! << 24) | (hash[1]! << 16) | (hash[2]! << 8) | hash[3]!) >>> 0;
}

/** Build a PRNG seeded deterministically from the input value. */
function prngFor(value: string, globalSeed: number): Mulberry32 {
  return new Mulberry32(valueSeed(value, globalSeed));
}

// ---------------------------------------------------------------------------
// Anonymizer class
// ---------------------------------------------------------------------------

export interface AnonymizerOptions {
  /** Master seed. Same seed → same pseudonyms (default: 1). */
  seed?: number;
}

export class Anonymizer {
  private readonly seed: number;

  constructor(opts: AnonymizerOptions = {}) {
    this.seed = opts.seed ?? 1;
  }

  /** Return a deterministic fake email for any source email. */
  email(source: string): string {
    const rng = prngFor(source.toLowerCase().trim(), this.seed);
    const first = FIRST_NAMES[rng.nextInt(FIRST_NAMES.length)]!.toLowerCase();
    const last = LAST_NAMES[rng.nextInt(LAST_NAMES.length)]!.toLowerCase();
    const domain = rng.pick(TEST_EMAIL_DOMAINS);
    return `${first}.${last}@${domain}`;
  }

  /** Return a deterministic fake full name for any source name. */
  fullName(source: string): string {
    const rng = prngFor(source.toLowerCase().trim(), this.seed);
    return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  }

  /** Return a deterministic fake first name. */
  firstName(source: string): string {
    return prngFor(source.toLowerCase().trim(), this.seed).pick(FIRST_NAMES);
  }

  /** Return a deterministic fake last name. */
  lastName(source: string): string {
    return prngFor(source.toLowerCase().trim(), this.seed).pick(LAST_NAMES);
  }

  /** Return a deterministic TEST-NET IPv4 address (192.0.2.x etc.). */
  ipv4(source: string): string {
    const rng = prngFor(source, this.seed);
    const prefix = rng.pick(TEST_IP_PREFIXES);
    const last = rng.nextInt(256);
    return `${prefix}.${last}`;
  }

  /** Return a deterministic fake phone number in E.164 format. */
  phone(source: string): string {
    const rng = prngFor(source, this.seed);
    // Use +15550000000 range (555 numbers reserved for fiction/testing)
    const suffix = String(rng.nextInt(10000)).padStart(4, '0');
    return `+1555000${suffix}`;
  }

  /** Return a deterministic fake organisation/company name. */
  orgName(source: string): string {
    const rng = prngFor(source.toLowerCase().trim(), this.seed);
    const adj = rng.pick(['Acme', 'Apex', 'Blue', 'Cloud', 'Delta', 'Eagle',
      'Fox', 'Globe', 'Horizon', 'Iris', 'Jade', 'Kite']);
    const noun = rng.pick(['Corp', 'Inc', 'Ltd', 'Group', 'Systems', 'Solutions',
      'Labs', 'Services', 'Partners', 'Networks']);
    return `${adj} ${noun}`;
  }

  /** Return a stable UUID v4-shaped string derived from source. */
  uuid(source: string): string {
    const rng = prngFor(source, this.seed);
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    const b = Array.from({ length: 16 }, () => rng.nextInt(256));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    return [
      [b[0], b[1], b[2], b[3]].map(hex).join(''),
      [b[4], b[5]].map(hex).join(''),
      [b[6], b[7]].map(hex).join(''),
      [b[8], b[9]].map(hex).join(''),
      [b[10], b[11], b[12], b[13], b[14], b[15]].map(hex).join(''),
    ].join('-');
  }

  /**
   * Anonymise free-text bodies (comment content, AI summaries, ticket subjects).
   * Free-text is DROPPED entirely (not pattern-masked) because partial masking
   * of unstructured text is unreliable.
   */
  freeText(_source: string): string {
    return '[ANONYMISED_TEXT]';
  }
}
