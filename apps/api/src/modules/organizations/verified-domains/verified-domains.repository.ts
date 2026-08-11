/**
 * VerifiedDomainsRepository — data access for organization_verified_domains.
 *
 * Extends TenantRepository so all queries run inside the RLS-bound tenant
 * transaction. All mutation methods are decorated with @Auditable.
 *
 * Domain uniqueness: enforced by the DB unique index on (tenant_id, lower(domain)).
 * The repository surfaces uniqueness violations as a 'DUPLICATE_DOMAIN' sentinel
 * so the service can convert them to the correct 409 response.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, sql, isNull } from 'drizzle-orm';
import {
  organizationVerifiedDomains,
  type OrganizationVerifiedDomain,
  type NewOrganizationVerifiedDomain,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { Auditable } from '../../audit/auditable.decorator';

@Injectable()
export class VerifiedDomainsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findByOrgId(
    tenantId: string,
    organizationId: string,
  ): Promise<OrganizationVerifiedDomain[]> {
    return this.tx
      .select()
      .from(organizationVerifiedDomains)
      .where(
        and(
          eq(organizationVerifiedDomains.tenantId, tenantId),
          eq(organizationVerifiedDomains.organizationId, organizationId),
        ),
      )
      .orderBy(organizationVerifiedDomains.createdAt);
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<OrganizationVerifiedDomain | null> {
    const rows = await this.tx
      .select()
      .from(organizationVerifiedDomains)
      .where(
        and(
          eq(organizationVerifiedDomains.tenantId, tenantId),
          eq(organizationVerifiedDomains.id, id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByDomain(
    tenantId: string,
    domain: string,
  ): Promise<OrganizationVerifiedDomain | null> {
    const rows = await this.tx
      .select()
      .from(organizationVerifiedDomains)
      .where(
        and(
          eq(organizationVerifiedDomains.tenantId, tenantId),
          sql`lower(${organizationVerifiedDomains.domain}) = lower(${domain})`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Resolver query: returns all verified (non-revoked) domains for this tenant.
   * Used by resolveOrganizationByEmailDomain.
   */
  async findVerifiedByTenant(
    tenantId: string,
  ): Promise<OrganizationVerifiedDomain[]> {
    return this.tx
      .select()
      .from(organizationVerifiedDomains)
      .where(
        and(
          eq(organizationVerifiedDomains.tenantId, tenantId),
          eq(organizationVerifiedDomains.status, 'verified'),
          isNull(organizationVerifiedDomains.revokedAt),
        ),
      );
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  @Auditable()
  async createDomain(
    tenantId: string,
    data: Pick<
      NewOrganizationVerifiedDomain,
      'organizationId' | 'domain' | 'includeSubdomains' | 'challengeTokenHash'
    >,
  ): Promise<OrganizationVerifiedDomain | 'DUPLICATE_DOMAIN'> {
    try {
      const rows = await this.tx
        .insert(organizationVerifiedDomains)
        .values({
          tenantId,
          organizationId: data.organizationId,
          domain: data.domain,
          includeSubdomains: data.includeSubdomains ?? false,
          challengeTokenHash: data.challengeTokenHash ?? null,
          status: 'pending',
          verifiedVia: 'dns_txt',
        })
        .returning();
      return rows[0]!;
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        // Unique constraint violation on (tenant_id, lower(domain))
        return 'DUPLICATE_DOMAIN';
      }
      throw err;
    }
  }

  @Auditable()
  async setVerified(
    tenantId: string,
    id: string,
    verifiedBy: string,
    verifiedVia: 'dns_txt' | 'admin_override',
  ): Promise<OrganizationVerifiedDomain | null> {
    const rows = await this.tx
      .update(organizationVerifiedDomains)
      .set({
        status: 'verified',
        verifiedAt: new Date(),
        verifiedBy,
        verifiedVia,
        challengeTokenHash: null, // clear token after verification
      })
      .where(
        and(
          eq(organizationVerifiedDomains.tenantId, tenantId),
          eq(organizationVerifiedDomains.id, id),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  @Auditable()
  async setRevoked(
    tenantId: string,
    id: string,
  ): Promise<OrganizationVerifiedDomain | null> {
    const rows = await this.tx
      .update(organizationVerifiedDomains)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
      })
      .where(
        and(
          eq(organizationVerifiedDomains.tenantId, tenantId),
          eq(organizationVerifiedDomains.id, id),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
