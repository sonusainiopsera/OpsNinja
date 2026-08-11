/**
 * UsersController — user-level org scope management.
 *
 * GET  /api/v1/users/:userId/org-scope — read current scope set for an agent
 * PUT  /api/v1/users/:userId/org-scope — replace scope set (full replacement, PUT semantics)
 *
 * Both endpoints require org:manage_scopes permission (Manager or Administrator).
 *
 * Response shapes match the WO-013 API contract:
 *   GET → { userId, tenantWide, organizationIds, scopeVersion }
 *   PUT → { scopeVersion, added, removed }
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';

import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { AgentScopesService } from '../organizations/agent-scopes.service';
import { getPrincipalContext } from '../../observability/request-context';
import type {
  GetUserOrgScopeResponse,
  ReplaceUserOrgScopeRequest,
  ReplaceUserOrgScopeResponse,
} from './dto/org-scope.dto';

@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly agentScopesService: AgentScopesService) {}

  /**
   * GET /api/v1/users/:userId/org-scope
   * Returns the current org scope set for the specified user.
   */
  @RequirePermissions('org:manage_scopes')
  @Get(':userId/org-scope')
  async getUserOrgScope(@Param('userId') userId: string): Promise<GetUserOrgScopeResponse> {
    const principal = getPrincipalContext();
    return this.agentScopesService.getUserOrgScope(principal.tenantId, userId);
  }

  /**
   * PUT /api/v1/users/:userId/org-scope
   * Replaces the org scope set. Returns the added/removed diff.
   */
  @RequirePermissions('org:manage_scopes')
  @Put(':userId/org-scope')
  async replaceUserOrgScope(
    @Param('userId') userId: string,
    @Body() body: ReplaceUserOrgScopeRequest,
  ): Promise<ReplaceUserOrgScopeResponse> {
    const principal = getPrincipalContext();
    return this.agentScopesService.replaceUserOrgScope(
      principal.tenantId,
      userId,
      body,
    );
  }
}
