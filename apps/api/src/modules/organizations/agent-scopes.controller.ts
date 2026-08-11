/**
 * AgentScopesController — CRUD for agent organization scope assignments.
 *
 * GET  /api/v1/organizations/agent-scopes/:userId — read current scope set
 * PUT  /api/v1/organizations/agent-scopes/:userId — replace scope set
 *
 * Both endpoints require org:manage_scopes permission (Manager or Administrator).
 * Out-of-tenant user/org IDs return 404 (existence masking).
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';

import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { AgentScopesService } from './agent-scopes.service';
import type { UpdateAgentScopesDto } from './dto/update-agent-scopes.dto';
import { getPrincipalContext } from '../../observability/request-context';

@Controller('api/v1/organizations/agent-scopes')
export class AgentScopesController {
  constructor(private readonly agentScopesService: AgentScopesService) {}

  @RequirePermissions('org:manage_scopes')
  @Get(':userId')
  async getAgentScopes(@Param('userId') userId: string) {
    const principal = getPrincipalContext();
    return this.agentScopesService.getAgentScopes(principal.tenantId, userId);
  }

  @RequirePermissions('org:manage_scopes')
  @Put(':userId')
  async replaceAgentScopes(
    @Param('userId') userId: string,
    @Body() body: UpdateAgentScopesDto,
  ) {
    const principal = getPrincipalContext();
    return this.agentScopesService.replaceAgentScopes(
      principal.tenantId,
      userId,
      body.scopes,
    );
  }
}
