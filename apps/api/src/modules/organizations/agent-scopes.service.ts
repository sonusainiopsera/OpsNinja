/**
 * AgentScopesService — reads and mutates agent organization scope assignments.
 *
 * Every write:
 *  1. Validates all referenced organization IDs belong to the caller's tenant.
 *  2. Detects duplicate org IDs in the request (422 DUPLICATE_ORGANIZATION).
 *  3. Replaces the entire scope set (PUT semantics — no partial updates).
 *  4. Writes an audit record capturing before and after scope sets.
 *  5. Bumps the Redis scope_version counter (atomic INCR).
 *  6. Updates the scope_version column in the DB rows.
 *
 * All DB access is through the tenant transaction handle (TenantRepository).
 * Cross-tenant access is prevented by the org membership validation check.
 */

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { agentOrgScopes, organizations, users } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { OrgScopeService } from '../../common/auth/org-scope.service';
import { AuditWriter } from '../audit/audit-writer';
import type {
  AgentScopeEntry,
  AgentScopeOrganization,
  GetAgentScopesResponse,
  UpdateAgentScopesResponse,
} from './dto/update-agent-scopes.dto';

@Injectable()
export class AgentScopesService extends TenantRepository {
  constructor(
    private readonly orgScopeService: OrgScopeService,
    private readonly auditWriter: AuditWriter,
  ) {
    super();
  }

  async getAgentScopes(
    tenantId: string,
    userId: string,
  ): Promise<GetAgentScopesResponse> {
    // Verify user exists in tenant
    const userRows = await this.tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);

    if (userRows.length === 0) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested user does not exist',
      });
    }

    const scopeRows = await this.tx
      .select({
        organizationId: agentOrgScopes.organizationId,
        accessLevel: agentOrgScopes.accessLevel,
        scopeVersion: agentOrgScopes.scopeVersion,
        orgName: organizations.name,
      })
      .from(agentOrgScopes)
      .innerJoin(
        organizations,
        eq(agentOrgScopes.organizationId, organizations.id),
      )
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );

    const scopeVersion = scopeRows[0]?.scopeVersion ?? 0;

    const orgList: AgentScopeOrganization[] = scopeRows.map((r) => ({
      organization_id: r.organizationId,
      name: r.orgName,
      access_level: r.accessLevel,
    }));

    return { user_id: userId, scope_version: scopeVersion, organizations: orgList };
  }

  async replaceAgentScopes(
    tenantId: string,
    userId: string,
    scopes: AgentScopeEntry[],
  ): Promise<UpdateAgentScopesResponse> {
    // Detect duplicate org IDs in request
    const orgIds = scopes.map((s) => s.organization_id);
    const uniqueOrgIds = new Set(orgIds);
    if (uniqueOrgIds.size !== orgIds.length) {
      throw new UnprocessableEntityException({
        code: 'DUPLICATE_ORGANIZATION',
        message: 'Duplicate organization_id entries are not permitted',
      });
    }

    // Verify user exists in tenant
    const userRows = await this.tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);

    if (userRows.length === 0) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested user does not exist',
      });
    }

    // Validate all organization IDs belong to this tenant
    if (orgIds.length > 0) {
      const validOrgs = await this.tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.tenantId, tenantId),
            inArray(organizations.id, orgIds),
          ),
        );

      const validOrgSet = new Set(validOrgs.map((o) => o.id));
      const invalidOrgIds = orgIds.filter((id) => !validOrgSet.has(id));
      if (invalidOrgIds.length > 0) {
        // 422 — the caller sent invalid org IDs; this is a validation error, not a
        // resource-not-found. The offending IDs are returned so the client can fix them.
        throw new UnprocessableEntityException({
          code: 'ORG_SCOPE_INVALID_ORGANIZATION',
          message: 'One or more organization IDs do not belong to this tenant',
          details: { invalidOrganizationIds: invalidOrgIds },
        });
      }
    }

    // Capture before state for audit
    const beforeRows = await this.tx
      .select({ organizationId: agentOrgScopes.organizationId })
      .from(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );
    const beforeOrgIds = beforeRows.map((r) => r.organizationId);

    // Bump scope version atomically
    const newVersion = await this.orgScopeService.bumpScopeVersion(tenantId, userId);

    // Replace scope rows — delete all existing, insert new
    await this.tx
      .delete(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );

    if (scopes.length > 0) {
      await this.tx.insert(agentOrgScopes).values(
        scopes.map((s) => ({
          tenantId,
          userId,
          organizationId: s.organization_id,
          accessLevel: s.access_level ?? 'full',
          scopeVersion: newVersion,
        })),
      );
    }

    // Write audit record (atomic with the mutation — AuditWriter uses the same tx)
    await this.auditWriter.append({
      resourceType: 'agent_org_scopes',
      resourceId: userId,
      action: 'update',
      beforeState: { organizationIds: beforeOrgIds },
      afterState: { organizationIds: orgIds, scopeVersion: newVersion },
    });

    return { user_id: userId, scope_version: newVersion };
  }

  // ---------------------------------------------------------------------------
  // WO-013 endpoint shapes: /api/v1/users/:userId/org-scope
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/users/:userId/org-scope
   * Returns { userId, tenantWide, organizationIds, scopeVersion } per WO-013 contract.
   * tenantWide = true when the user has no org scope rows (unrestricted within their role).
   */
  async getUserOrgScope(
    tenantId: string,
    userId: string,
  ): Promise<{ userId: string; tenantWide: boolean; organizationIds: string[]; scopeVersion: number }> {
    const userRows = await this.tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);

    if (userRows.length === 0) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested user does not exist',
      });
    }

    const scopeRows = await this.tx
      .select({
        organizationId: agentOrgScopes.organizationId,
        scopeVersion: agentOrgScopes.scopeVersion,
      })
      .from(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );

    const organizationIds = scopeRows.map((r) => r.organizationId);
    const scopeVersion = scopeRows[0]?.scopeVersion ?? 0;
    const tenantWide = organizationIds.length === 0;

    return { userId, tenantWide, organizationIds, scopeVersion };
  }

  /**
   * PUT /api/v1/users/:userId/org-scope
   * Replaces org scope set. Returns { scopeVersion, added, removed } per WO-013 contract.
   * When tenantWide=true, clears all scope rows (user is unrestricted by org scope).
   */
  async replaceUserOrgScope(
    tenantId: string,
    userId: string,
    body: { tenantWide?: boolean; organizationIds: string[] },
  ): Promise<{ scopeVersion: number; added: string[]; removed: string[] }> {
    const orgIds = body.tenantWide ? [] : body.organizationIds;

    // Detect duplicate org IDs in request
    const uniqueOrgIds = new Set(orgIds);
    if (uniqueOrgIds.size !== orgIds.length) {
      throw new UnprocessableEntityException({
        code: 'DUPLICATE_ORGANIZATION',
        message: 'Duplicate organization IDs are not permitted',
      });
    }

    // Verify user exists in tenant
    const userRows = await this.tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);

    if (userRows.length === 0) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested user does not exist',
      });
    }

    // Validate all organization IDs belong to this tenant
    if (orgIds.length > 0) {
      const validOrgs = await this.tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.tenantId, tenantId),
            inArray(organizations.id, orgIds),
          ),
        );

      const validOrgSet = new Set(validOrgs.map((o) => o.id));
      const invalidOrgIds = orgIds.filter((id) => !validOrgSet.has(id));
      if (invalidOrgIds.length > 0) {
        throw new UnprocessableEntityException({
          code: 'ORG_SCOPE_INVALID_ORGANIZATION',
          message: 'One or more organization IDs do not belong to this tenant',
          details: { invalidOrganizationIds: invalidOrgIds },
        });
      }
    }

    // Capture before state for added/removed diff
    const beforeRows = await this.tx
      .select({ organizationId: agentOrgScopes.organizationId })
      .from(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );
    const beforeOrgIds = beforeRows.map((r) => r.organizationId);
    const beforeSet = new Set(beforeOrgIds);
    const afterSet = new Set(orgIds);

    const added = orgIds.filter((id) => !beforeSet.has(id));
    const removed = beforeOrgIds.filter((id) => !afterSet.has(id));

    // Bump scope version atomically
    const newVersion = await this.orgScopeService.bumpScopeVersion(tenantId, userId);

    // Replace scope rows
    await this.tx
      .delete(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );

    if (orgIds.length > 0) {
      await this.tx.insert(agentOrgScopes).values(
        orgIds.map((orgId) => ({
          tenantId,
          userId,
          organizationId: orgId,
          accessLevel: 'full',
          scopeVersion: newVersion,
        })),
      );
    }

    // Write audit record (atomic with the mutation)
    await this.auditWriter.append({
      resourceType: 'agent_org_scopes',
      resourceId: userId,
      action: 'update',
      beforeState: { organizationIds: beforeOrgIds, tenantWide: beforeOrgIds.length === 0 },
      afterState: {
        organizationIds: orgIds,
        tenantWide: body.tenantWide ?? false,
        scopeVersion: newVersion,
        added,
        removed,
      },
    });

    return { scopeVersion: newVersion, added, removed };
  }
}
