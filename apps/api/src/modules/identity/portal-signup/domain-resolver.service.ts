/**
 * DomainResolverService — the ONLY cross-tenant read in the portal signup module.
 *
 * Purpose:
 *   Match a normalised email domain against organizations.verified_domains
 *   to discover which tenant + organisation the applicant belongs to.
 *
 * Security constraints:
 *   - This is the ONE deliberately cross-tenant read in this module.
 *     It uses a platform-level pool connection (no RLS tenant filter) to scan
 *     all tenant domains. Every other DB access in the module is tenant-scoped.
 *   - Deactivated organisations are excluded — treat as unmatched.
 *   - Ambiguous (multi-match) results are not resolved here; the caller
 *     decides whether to auto-bind (1 match) or route to admin approval.
 *   - This method MUST NOT be used for any purpose other than signup domain
 *     resolution. Its elevated privilege is narrowly scoped and code-reviewed.
 *
 * Implementation:
 *   Uses the raw pg.Pool directly (bypassing Drizzle and the tenant-transaction
 *   wrapper) to perform a deliberate cross-tenant lookup. The pool instance is
 *   the same one used by the unit-of-work — no separate connection is created.
 */

import { Injectable, Logger } from '@nestjs/common';
import { pool } from '@opsninja/db';

export interface CandidateOrganisation {
  tenantId: string;
  organizationId: string;
  organizationName: string;
  domain: string;
}

@Injectable()
export class DomainResolverService {
  private readonly logger = new Logger(DomainResolverService.name);

  /**
   * Resolve a normalised email domain to the set of matching organisations.
   *
   * Returns an empty array for unmatched domains.
   * Returns multiple entries when the same domain is configured for more than
   * one organisation (across the same or different tenants) — the caller must
   * NOT auto-bind in that case.
   *
   * @param domain  Lowercase, punycode-normalised domain (e.g. 'acmecorp.com')
   */
  async resolveEmailDomain(domain: string): Promise<CandidateOrganisation[]> {
    const client = await pool.connect();
    try {
      // -----------------------------------------------------------------
      // Cross-tenant lookup — deliberately bypasses RLS.
      // This is the ONLY cross-tenant DB read in the portal signup module.
      // Deactivated organisations (status != 'active') are excluded.
      // -----------------------------------------------------------------
      const result = await client.query<{
        tenant_id: string;
        organization_id: string;
        organization_name: string;
        domain: string;
      }>(
        `SELECT
           ovd.tenant_id,
           ovd.organization_id,
           o.name AS organization_name,
           ovd.domain
         FROM organization_verified_domains ovd
         JOIN organizations o
           ON o.id = ovd.organization_id
          AND o.tenant_id = ovd.tenant_id
         WHERE lower(ovd.domain) = lower($1)
           AND (o.status IS NULL OR o.status = 'active')
         ORDER BY ovd.tenant_id, ovd.organization_id`,
        [domain],
      );

      const candidates = result.rows.map((row) => ({
        tenantId: row.tenant_id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        domain: row.domain,
      }));

      this.logger.debug('Domain resolution result', {
        domain,
        candidateCount: candidates.length,
      });

      return candidates;
    } finally {
      client.release();
    }
  }
}
