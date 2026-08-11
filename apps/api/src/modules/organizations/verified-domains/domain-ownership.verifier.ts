/**
 * DomainOwnershipVerifier — interface + implementations for DNS TXT verification.
 *
 * The interface is injected into VerifiedDomainsService so the DNS implementation
 * can be swapped with a deterministic stub in tests.
 *
 * Challenge format:
 *   Record name:  _opsninja-verification.<domain>
 *   Record value: opsninja-domain-verification=<hex-token>
 *
 * The raw token is 32 cryptographically random bytes (64-char hex). Only the
 * SHA-256 hash is persisted. The raw value is returned once at registration
 * time and never stored.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Resolver } from 'dns';
import { promisify } from 'util';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ChallengePayload {
  /** Raw 64-char hex token returned once to the caller. Never persisted. */
  rawToken: string;
  /** SHA-256 hex hash stored in challenge_token_hash column. */
  tokenHash: string;
  /** DNS TXT record name (e.g. _opsninja-verification.acme.com). */
  recordName: string;
  /** DNS TXT record value (e.g. opsninja-domain-verification=<token>). */
  recordValue: string;
}

export interface VerifyResult {
  verified: boolean;
  /** The TXT record value that was expected. */
  expectedRecord: string;
  /** All TXT records observed (flattened). Empty on DNS error. */
  observedRecords: string[];
  /** NXDOMAIN | TIMEOUT | SERVFAIL | null (no error) */
  dnsError: 'NXDOMAIN' | 'TIMEOUT' | 'SERVFAIL' | null;
}

export abstract class DomainOwnershipVerifier {
  abstract generateChallenge(domain: string): ChallengePayload;
  abstract verify(domain: string, expectedTokenHash: string): Promise<VerifyResult>;
}

// ---------------------------------------------------------------------------
// DNS implementation
// ---------------------------------------------------------------------------

/** Timeout for a single DNS query attempt (ms). */
const DNS_TIMEOUT_MS = 5_000;
/** Maximum retry attempts before giving up. */
const DNS_MAX_RETRIES = 2;
/** TXT record prefix that identifies our challenge. */
const CHALLENGE_PREFIX = 'opsninja-domain-verification=';
/** DNS record subdomain prefix. */
const RECORD_SUBDOMAIN = '_opsninja-verification';

@Injectable()
export class DnsDomainOwnershipVerifier extends DomainOwnershipVerifier {
  private readonly logger = new Logger(DnsDomainOwnershipVerifier.name);

  generateChallenge(domain: string): ChallengePayload {
    const rawToken = randomBytes(32).toString('hex'); // 64 hex chars
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const recordName = `${RECORD_SUBDOMAIN}.${domain}`;
    const recordValue = `${CHALLENGE_PREFIX}${rawToken}`;
    return { rawToken, tokenHash, recordName, recordValue };
  }

  async verify(domain: string, expectedTokenHash: string): Promise<VerifyResult> {
    const recordName = `${RECORD_SUBDOMAIN}.${domain}`;
    const expectedRecord = `${CHALLENGE_PREFIX}<token>`; // shown in error messages

    let lastError: NodeJS.ErrnoException | null = null;
    let observedRecords: string[] = [];

    for (let attempt = 0; attempt <= DNS_MAX_RETRIES; attempt++) {
      try {
        const records = await this._resolveTxtWithTimeout(recordName);
        // Flatten: resolveTxt returns string[][] (each element is an array of chunks)
        observedRecords = records.flat();

        // Check if any record matches the expected token hash
        const matched = observedRecords.some((record) => {
          if (!record.startsWith(CHALLENGE_PREFIX)) return false;
          const token = record.slice(CHALLENGE_PREFIX.length);
          const hash = createHash('sha256').update(token).digest('hex');
          return hash === expectedTokenHash;
        });

        if (matched) {
          return { verified: true, expectedRecord, observedRecords, dnsError: null };
        }

        // Records found but none matched
        return { verified: false, expectedRecord, observedRecords, dnsError: null };
      } catch (err: unknown) {
        lastError = err as NodeJS.ErrnoException;
        this.logger.warn('DNS TXT lookup attempt failed', {
          domain,
          recordName,
          attempt: attempt + 1,
          code: lastError?.code,
        });
        if (lastError?.code === 'ENODATA' || lastError?.code === 'ENOTFOUND') {
          // NXDOMAIN / no TXT records — no point retrying
          break;
        }
        // For transient errors (ETIMEOUT, ESERVFAIL) allow retries
      }
    }

    const code = lastError?.code ?? '';
    let dnsError: VerifyResult['dnsError'] = null;
    if (code === 'ENOTFOUND' || code === 'ENODATA') dnsError = 'NXDOMAIN';
    else if (code === 'ETIMEOUT' || code === 'ETIMEDOUT') dnsError = 'TIMEOUT';
    else dnsError = 'SERVFAIL';

    return {
      verified: false,
      expectedRecord: `${CHALLENGE_PREFIX}<token>`,
      observedRecords,
      dnsError,
    };
  }

  private _resolveTxtWithTimeout(hostname: string): Promise<string[][]> {
    return new Promise((resolve, reject) => {
      const resolver = new Resolver();
      const timer = setTimeout(() => {
        resolver.cancel();
        const err: NodeJS.ErrnoException = new Error(`DNS timeout for ${hostname}`);
        err.code = 'ETIMEOUT';
        reject(err);
      }, DNS_TIMEOUT_MS);

      const resolveTxt = promisify(resolver.resolveTxt.bind(resolver));
      resolveTxt(hostname)
        .then((records) => {
          clearTimeout(timer);
          resolve(records);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

// ---------------------------------------------------------------------------
// Stub implementation — for tests
// ---------------------------------------------------------------------------

/**
 * Deterministic stub verifier for unit and integration tests.
 *
 * Pre-configure which domains should return verified/unverified results.
 */
@Injectable()
export class StubDomainOwnershipVerifier extends DomainOwnershipVerifier {
  /** Map<domain, verifyResult>. Entries set by tests. */
  private _results = new Map<string, Partial<VerifyResult>>();
  /** Challenges generated this session (for assertions in tests). */
  readonly generatedChallenges: Array<{ domain: string; payload: ChallengePayload }> = [];

  generateChallenge(domain: string): ChallengePayload {
    const rawToken = 'stubtokenstubtokenstubtokenstubtokenstubtokenstubtokenstubtoke01';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const recordName = `${RECORD_SUBDOMAIN}.${domain}`;
    const recordValue = `${CHALLENGE_PREFIX}${rawToken}`;
    const payload = { rawToken, tokenHash, recordName, recordValue };
    this.generatedChallenges.push({ domain, payload });
    return payload;
  }

  async verify(domain: string, expectedTokenHash: string): Promise<VerifyResult> {
    const override = this._results.get(domain);
    if (override) {
      return {
        verified: override.verified ?? false,
        expectedRecord: override.expectedRecord ?? `${CHALLENGE_PREFIX}<token>`,
        observedRecords: override.observedRecords ?? [],
        dnsError: override.dnsError ?? null,
      };
    }
    // Default: not verified, NXDOMAIN
    return {
      verified: false,
      expectedRecord: `${CHALLENGE_PREFIX}<token>`,
      observedRecords: [],
      dnsError: 'NXDOMAIN',
    };
  }

  /** Pre-program a domain to return verified=true on next verify() call. */
  setVerified(domain: string): void {
    const rawToken = 'stubtokenstubtokenstubtokenstubtokenstubtokenstubtokenstubtoke01';
    this._results.set(domain, {
      verified: true,
      observedRecords: [`${CHALLENGE_PREFIX}${rawToken}`],
      dnsError: null,
    });
  }

  setFailure(domain: string, dnsError: VerifyResult['dnsError']): void {
    this._results.set(domain, { verified: false, observedRecords: [], dnsError });
  }

  reset(): void {
    this._results.clear();
    this.generatedChallenges.length = 0;
  }
}
