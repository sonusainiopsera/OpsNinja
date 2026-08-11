/**
 * UserScopeController
 *
 * GET  /api/v1/users/:userId/org-scope
 *   Returns the current org scope for a staff user.
 *   Requires: organizations:manage_scopes (Manager or Administrator).
 *
 * PUT  /api/v1/users/:userId/org-scope
 *   Full-replacement of a staff user's org scope.
 *   Validates that every organizationId belongs to the caller's tenant.
 *   Bumps the Redis org_scope_version counter atomically.
 *   Returns an explicit added/removed diff and the new scope version.
 *   Writes an audit record.
 *   Requires: organizations:manage_scopes.
 *
 * 404 masking: unknown or out-of-tenant userId returns 404, never 403.
 * 422 on cross-tenant organizationId: ORG_SCOPE_INVALID_ORGANIZATION.
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
import { OrgScopeService } from './services/org-scope.service';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { AuditWriter } from '../../common/audit/audit-writer';
import { RequestContextStore } from '../../observability/request-context';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { Permission } from '../../common/auth/permissions';
import { ErrorCode } from '../../common/errors/app-errors';
import {
  PutUserOrgScopeSchema,
  type GetUserOrgScopeResponse,
  type PutUserOrgScopeResponse,
} from './dto/user-scope.dto';

@Controller('users')
export class UserScopeController {
  private readonly logger = new Logger(UserScopeController.name);

  constructor(
    private readonly orgScopeService: OrgScopeService,
    private readonly orgsRepository: OrganizationsRepository,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * GET /api/v1/users/:userId/org-scope
   */
  @Get(':userId/org-scope')
  @RequirePermission(Permission.ORGS_MANAGE_SCOPES)
  async getUserOrgScope(
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<GetUserOrgScopeResponse> {
    const principal = RequestContextStore.getPrincipal();
    const { tenantId } = principal;

    const scopeRows = await this.orgScopeService.listScopes(tenantId, userId);
    const organizationIds = scopeRows.map((r) => r.organizationId);
    const tenantWide = organizationIds.length === 0;

    const scopeVersion = await this.orgScopeService.readScopeVersion(tenantId, userId);

    return {
      userId,
      tenantWide,
      organizationIds,
      scopeVersion,
    };
  }

  /**
   * PUT /api/v1/users/:userId/org-scope
   */
  @Put(':userId/org-scope')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ORGS_MANAGE_SCOPES)
  async putUserOrgScope(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: unknown,
  ): Promise<PutUserOrgScopeResponse> {
    const parsed = PutUserOrgScopeSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        errors: parsed.error.errors,
      });
    }

    const principal = RequestContextStore.getPrincipal();
    const { tenantId } = principal;
    const { tenantWide, organizationIds } = parsed.data;

    // Resolve effective org list (empty for tenantWide).
    const newOrgIds = tenantWide ? [] : organizationIds;

    // Validate every org ID belongs to the caller's tenant.
    if (newOrgIds.length > 0) {
      const found = await this.orgsRepository.findByIds(tenantId, newOrgIds);
      const foundIds = new Set(found.map((o) => o.id));
      const invalid = newOrgIds.filter((id) => !foundIds.has(id));
      if (invalid.length > 0) {
        throw new UnprocessableEntityException({
          code: ErrorCode.ORG_SCOPE_INVALID_ORGANIZATION,
          message: `Organization(s) not found in tenant: ${invalid.join(', ')}`,
          details: invalid.map((id) => ({ organizationId: id })),
        });
      }
    }

    // Capture before state for audit diff.
    const beforeRows = await this.orgScopeService.listScopes(tenantId, userId);
    const beforeIds = new Set(beforeRows.map((r) => r.organizationId));
    const afterIds = new Set(newOrgIds);

    const added = newOrgIds.filter((id) => !beforeIds.has(id));
    const removed = [...beforeIds].filter((id) => !afterIds.has(id));

    // Replace scope set and bump version.
    const newVersion = await this.orgScopeService.replaceScopes(
      tenantId,
      userId,
      newOrgIds.map((id) => ({ organizationId: id, accessLevel: 'full' })),
    );

    // Emit audit record with explicit added/removed diff.
    await this.auditWriter.append({
      action: 'user.org_scope.replaced',
      resourceType: 'user_org_scope',
      resourceId: userId,
      beforeState: {
        organizationIds: [...beforeIds],
        tenantWide: beforeIds.size === 0,
      },
      afterState: {
        organizationIds: newOrgIds,
        tenantWide,
        added,
        removed,
      },
      forceEmit: true,
    });

    this.logger.log({
      event: 'user.org_scope.replaced',
      tenantId,
      userId,
      newVersion,
      added: added.length,
      removed: removed.length,
    });

    return { scopeVersion: newVersion, added, removed };
  }
}
