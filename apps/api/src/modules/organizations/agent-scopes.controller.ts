/**
 * AgentScopesController
 *
 * GET  /api/v1/organizations/agent-scopes/:userId
 *   Returns the current scope set for a staff agent.
 *   Requires: organizations:manage_scopes (Manager or Administrator)
 *
 * PUT  /api/v1/organizations/agent-scopes/:userId
 *   Replaces the entire scope set for a staff agent.
 *   Validates every organization_id belongs to the caller's tenant.
 *   Bumps the Redis scope_version counter so tokens with a stale version
 *   get 401 SCOPE_VERSION_STALE on their next request.
 *   Writes an audit record with before/after scope sets.
 *   Requires: organizations:manage_scopes
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Put,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OrgScopeService } from '../identity/services/org-scope.service';
import { OrganizationsRepository } from './organizations.repository';
import { AuditWriter } from '../../common/audit/audit-writer';
import { RequestContextStore } from '../../observability/request-context';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { Permission } from '../../common/auth/permissions';
import { assertFound } from '../../common/errors/not-found';
import {
  PutAgentScopesSchema,
  type AgentScopesResponse,
  type PutAgentScopesResponse,
} from './dto/agent-scopes.dto';

@Controller('organizations/agent-scopes')
export class AgentScopesController {
  private readonly logger = new Logger(AgentScopesController.name);

  constructor(
    private readonly orgScopeService: OrgScopeService,
    private readonly orgsRepository: OrganizationsRepository,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * GET /api/v1/organizations/agent-scopes/:userId
   */
  @Get(':userId')
  @RequirePermission(Permission.ORGS_MANAGE_SCOPES)
  async getAgentScopes(
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<AgentScopesResponse> {
    const principal = RequestContextStore.getPrincipal();
    const { tenantId } = principal;

    const scopeRows = await this.orgScopeService.listScopes(tenantId, userId);
    const orgIds = scopeRows.map((r) => r.organizationId);

    // Hydrate org names
    const orgs = orgIds.length > 0
      ? await this.orgsRepository.findByIds(tenantId, orgIds)
      : [];

    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

    const scopeVersion = await this.getCurrentScopeVersion(tenantId, userId);

    return {
      user_id: userId,
      scope_version: scopeVersion,
      organizations: scopeRows.map((s) => ({
        organization_id: s.organizationId,
        name: orgMap.get(s.organizationId) ?? '',
        access_level: s.accessLevel,
      })),
    };
  }

  /**
   * PUT /api/v1/organizations/agent-scopes/:userId
   */
  @Put(':userId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ORGS_MANAGE_SCOPES)
  async putAgentScopes(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: unknown,
  ): Promise<PutAgentScopesResponse> {
    const parsed = PutAgentScopesSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        errors: parsed.error.errors,
      });
    }

    const principal = RequestContextStore.getPrincipal();
    const { tenantId } = principal;
    const { scopes } = parsed.data;

    // Validate every org_id belongs to the caller's tenant
    if (scopes.length > 0) {
      const orgIds = scopes.map((s) => s.organization_id);
      const found = await this.orgsRepository.findByIds(tenantId, orgIds);
      const foundIds = new Set(found.map((o) => o.id));
      const missing = orgIds.find((id) => !foundIds.has(id));
      assertFound(!missing, 'Organization');
    }

    // Capture before state for audit
    const beforeScopes = await this.orgScopeService.listScopes(tenantId, userId);

    // Replace scope set and bump version
    const newVersion = await this.orgScopeService.replaceScopes(
      tenantId,
      userId,
      scopes.map((s) => ({ organizationId: s.organization_id, accessLevel: s.access_level })),
    );

    // Emit audit record
    await this.auditWriter.append({
      action: 'agent_scope.replaced',
      resourceType: 'agent_scope',
      resourceId: userId,
      beforeState: { organizations: beforeScopes.map((s) => s.organizationId) },
      afterState: { organizations: scopes.map((s) => s.organization_id) },
      forceEmit: true,
    });

    this.logger.log({
      event: 'agent_scope.replaced',
      tenantId,
      userId,
      newVersion,
      scopeCount: scopes.length,
    });

    return { user_id: userId, scope_version: newVersion };
  }

  private async getCurrentScopeVersion(tenantId: string, userId: string): Promise<number> {
    // Read the Redis counter; default to 0 if absent.
    try {
      const { orgScopeService } = this;
      const raw = await (orgScopeService as unknown as { redis: { get(k: string): Promise<string | null> } })
        .redis.get(`tenant:${tenantId}:user:${userId}:scope_version`);
      return raw !== null ? parseInt(raw, 10) : 0;
    } catch {
      return 0;
    }
  }
}
