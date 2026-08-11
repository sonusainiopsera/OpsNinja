/**
 * VerifiedDomainsService — lifecycle state machine for organization domain ownership.
 *
 * State machine:  [pending] → verified  (via DNS TXT or admin override)
 *                 [pending | verified] → revoked
 *
 * All transitions emit an audit record via @Auditable on the repository.
 *
 * Public interface exposed on OrganizationsModule:
 *   resolveOrganizationByEmailDomain(tenantId, emailDomain) → { organizationId } | null
 *
 * Fail-closed principle:
 *   - Any domain that is not in the 'verified' state is excluded from binding.
 *   - Ambiguous data (multiple verified domains for the same email domain
 *     within a tenant) logs a critical alert and returns null.
 *   - DNS errors return 422 with actionable detail; they never produce 500.
 *
 * Module boundary rule:
 *   The sign-up module calls resolveOrganizationByEmailDomain on this service
 *   (via OrganizationsService facade), never querying the table directly.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { VerifiedDomainsRepository } from './verified-domains.repository';
import { DomainOwnershipVerifier } from './domain-ownership.verifier';
import {
  normalizeDomain,
  extractEmailDomain,
  isPublicSuffix,
  isSubdomainOf,
} from './domain-normalizer';
import { isDeniedDomain } from '../../identity/portal-signup/free-mail-domains.data';
import type { RegisterDomainDto, AdminOverrideDto } from './dto/verified-domain.dto';
import type { OrganizationVerifiedDomain } from '@opsninja/db';

export interface DomainRegistrationResult {
  domain: OrganizationVerifiedDomain;
  /** Raw token shown once — never persisted. Null after first registration response. */
  rawToken: string;
  recordName: string;
  recordValue: string;
}

export interface DomainResolveResult {
  organizationId: string;
}

@Injectable()
export class VerifiedDomainsService {
  private readonly logger = new Logger(VerifiedDomainsService.name);

  constructor(
    private readonly repo: VerifiedDomainsRepository,
    private readonly verifier: DomainOwnershipVerifier,
  ) {}

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  async listByOrg(
    tenantId: string,
    organizationId: string,
  ): Promise<OrganizationVerifiedDomain[]> {
    return this.repo.findByOrgId(tenantId, organizationId);
  }

  // --------------------------------------------------------------------------
  // Register (pending state)
  // --------------------------------------------------------------------------

  async register(
    tenantId: string,
    organizationId: string,
    dto: RegisterDomainDto,
  ): Promise<DomainRegistrationResult> {
    // Normalise
    const normResult = normalizeDomain(dto.domain);
    if (!normResult.ok) {
      throw new BadRequestException({
        error: { code: 'DOMAIN_INVALID', message: normResult.reason },
      });
    }
    const domain = normResult.domain;

    // Free-mail / disposable deny-list
    if (isDeniedDomain(domain)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'DOMAIN_NOT_ALLOWED',
          message: `"${domain}" is a free-mail or disposable provider and cannot be registered as an organization domain.`,
        },
      });
    }

    // Public suffix check (belt-and-suspenders beyond normalizer)
    if (isPublicSuffix(domain)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'DOMAIN_IS_PUBLIC_SUFFIX',
          message: `"${domain}" is a public suffix and cannot be claimed.`,
        },
      });
    }

    // Generate DNS challenge
    const challenge = this.verifier.generateChallenge(domain);

    const result = await this.repo.createDomain(tenantId, {
      organizationId,
      domain,
      includeSubdomains: dto.includeSubdomains ?? false,
      challengeTokenHash: challenge.tokenHash,
    });

    if (result === 'DUPLICATE_DOMAIN') {
      throw new ConflictException({
        error: {
          code: 'VERIFIED_DOMAIN_CONFLICT',
          message: `Domain "${domain}" is already registered for an organization in this tenant.`,
        },
      });
    }

    this.logger.log('Domain registered (pending verification)', {
      tenantId,
      organizationId,
      domain,
      domainId: result.id,
    });

    return {
      domain: result,
      rawToken: challenge.rawToken,
      recordName: challenge.recordName,
      recordValue: challenge.recordValue,
    };
  }

  // --------------------------------------------------------------------------
  // Verify via DNS TXT
  // --------------------------------------------------------------------------

  async verifyViaDns(
    tenantId: string,
    organizationId: string,
    id: string,
    actorId: string,
  ): Promise<OrganizationVerifiedDomain> {
    const entry = await this._assertOwned(tenantId, organizationId, id);

    if (entry.status === 'verified') {
      return entry; // idempotent
    }
    if (entry.status === 'revoked') {
      throw new UnprocessableEntityException({
        error: {
          code: 'DOMAIN_REVOKED',
          message: 'A revoked domain cannot be re-verified. Register a new entry.',
        },
      });
    }
    if (!entry.challengeTokenHash) {
      throw new UnprocessableEntityException({
        error: {
          code: 'CHALLENGE_NOT_FOUND',
          message: 'No challenge token exists for this domain entry.',
        },
      });
    }

    const result = await this.verifier.verify(entry.domain, entry.challengeTokenHash);

    if (!result.verified) {
      const reason =
        result.dnsError === 'NXDOMAIN'
          ? 'The DNS TXT record was not found.'
          : result.dnsError === 'TIMEOUT'
            ? 'The DNS lookup timed out. Please retry in a few minutes.'
            : result.dnsError === 'SERVFAIL'
              ? 'The DNS server returned an error (SERVFAIL). Please retry.'
              : 'The verification record was not found or did not match.';

      this.logger.warn('Domain verification failed', {
        tenantId,
        domain: entry.domain,
        dnsError: result.dnsError,
      });

      throw new UnprocessableEntityException({
        error: {
          code: 'DOMAIN_VERIFICATION_FAILED',
          message: reason,
          details: [
            {
              expectedRecordValue: result.expectedRecord,
              observedRecords: result.observedRecords,
              dnsError: result.dnsError,
            },
          ],
        },
      });
    }

    const updated = await this.repo.setVerified(tenantId, id, actorId, 'dns_txt');
    if (!updated) {
      throw new NotFoundException({
        error: { code: 'DOMAIN_NOT_FOUND', message: `Domain entry ${id} not found.` },
      });
    }

    this.logger.log('Domain verified via DNS TXT', {
      tenantId,
      domain: entry.domain,
      domainId: id,
      actorId,
    });

    return updated;
  }

  // --------------------------------------------------------------------------
  // Admin override
  // --------------------------------------------------------------------------

  async adminOverride(
    tenantId: string,
    organizationId: string,
    id: string,
    dto: AdminOverrideDto,
    actorId: string,
  ): Promise<OrganizationVerifiedDomain> {
    const entry = await this._assertOwned(tenantId, organizationId, id);

    if (entry.status === 'verified') {
      return entry; // idempotent
    }
    if (entry.status === 'revoked') {
      throw new UnprocessableEntityException({
        error: {
          code: 'DOMAIN_REVOKED',
          message: 'A revoked domain cannot be re-verified. Register a new entry.',
        },
      });
    }

    const updated = await this.repo.setVerified(tenantId, id, actorId, 'admin_override');
    if (!updated) {
      throw new NotFoundException({
        error: { code: 'DOMAIN_NOT_FOUND', message: `Domain entry ${id} not found.` },
      });
    }

    this.logger.log('Domain verified via admin override', {
      tenantId,
      domain: entry.domain,
      domainId: id,
      actorId,
      justification: dto.justification,
    });

    return updated;
  }

  // --------------------------------------------------------------------------
  // Revoke
  // --------------------------------------------------------------------------

  async revoke(
    tenantId: string,
    organizationId: string,
    id: string,
  ): Promise<OrganizationVerifiedDomain> {
    const entry = await this._assertOwned(tenantId, organizationId, id);

    if (entry.status === 'revoked') {
      return entry; // idempotent
    }

    const updated = await this.repo.setRevoked(tenantId, id);
    if (!updated) {
      throw new NotFoundException({
        error: { code: 'DOMAIN_NOT_FOUND', message: `Domain entry ${id} not found.` },
      });
    }

    this.logger.log('Domain revoked', { tenantId, domain: entry.domain, domainId: id });

    return updated;
  }

  // --------------------------------------------------------------------------
  // Resolver — public interface for OrganizationsService
  // --------------------------------------------------------------------------

  /**
   * Resolve an email domain to at most one organization within the tenant.
   *
   * Resolution rules:
   *   1. Only 'verified' (non-revoked) entries participate.
   *   2. Exact match takes priority over wildcard (include_subdomains) match.
   *   3. If multiple entries match after most-specific-wins, log CRITICAL and
   *      return null (fail-closed: ambiguity never picks a winner).
   *
   * @param tenantId     Current tenant context.
   * @param emailDomain  Normalised email domain (lowercase, punycode).
   * @returns { organizationId } or null for unmatched / ambiguous.
   */
  async resolveOrganizationByEmailDomain(
    tenantId: string,
    emailDomain: string,
  ): Promise<DomainResolveResult | null> {
    // Normalise input
    const normResult = normalizeDomain(emailDomain);
    if (!normResult.ok) {
      this.logger.warn('Cannot resolve invalid email domain', {
        tenantId,
        emailDomain,
        reason: normResult.reason,
      });
      return null;
    }
    const domain = normResult.domain;

    // Load all verified domains for this tenant
    const verified = await this.repo.findVerifiedByTenant(tenantId);
    if (verified.length === 0) return null;

    // Phase 1: exact matches
    const exactMatches = verified.filter(
      (v) => v.domain.toLowerCase() === domain,
    );

    if (exactMatches.length === 1) {
      return { organizationId: exactMatches[0]!.organizationId };
    }
    if (exactMatches.length > 1) {
      // DB unique index should prevent this — operator alert
      this.logger.error('AMBIGUOUS domain resolution: multiple exact verified entries for same domain', {
        tenantId,
        domain,
        matchCount: exactMatches.length,
      });
      return null; // fail-closed
    }

    // Phase 2: wildcard (include_subdomains) matches
    const wildcardMatches = verified.filter(
      (v) => v.includeSubdomains && isSubdomainOf(domain, v.domain.toLowerCase()),
    );

    if (wildcardMatches.length === 0) return null;

    // Most-specific wildcard: longest base domain wins
    wildcardMatches.sort((a, b) => b.domain.length - a.domain.length);
    const mostSpecific = wildcardMatches[0]!;

    // Ambiguity check: if top-2 share the same base domain length across different orgs
    if (
      wildcardMatches.length > 1 &&
      wildcardMatches[1]!.domain.length === mostSpecific.domain.length &&
      wildcardMatches[1]!.organizationId !== mostSpecific.organizationId
    ) {
      this.logger.error('AMBIGUOUS wildcard domain resolution', {
        tenantId,
        domain,
        matchCount: wildcardMatches.length,
      });
      return null; // fail-closed
    }

    return { organizationId: mostSpecific.organizationId };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async _assertOwned(
    tenantId: string,
    organizationId: string,
    id: string,
  ): Promise<OrganizationVerifiedDomain> {
    const entry = await this.repo.findById(tenantId, id);
    if (!entry) {
      throw new NotFoundException({
        error: { code: 'DOMAIN_NOT_FOUND', message: `Domain entry ${id} not found.` },
      });
    }
    if (entry.organizationId !== organizationId) {
      // Treat as not-found to avoid org-id enumeration
      throw new NotFoundException({
        error: { code: 'DOMAIN_NOT_FOUND', message: `Domain entry ${id} not found.` },
      });
    }
    return entry;
  }
}
