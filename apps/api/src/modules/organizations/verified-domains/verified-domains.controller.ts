/**
 * VerifiedDomainsController — REST endpoints for organization domain lifecycle.
 *
 * All routes live under /api/v1/organizations/:orgId/verified-domains.
 *
 * Endpoint map:
 *   GET    /                     List all domains for an org
 *   POST   /                     Register a domain (pending + challenge)
 *   POST   /:id/verify           Verify via DNS TXT lookup
 *   POST   /:id/override         Admin override (mandatory justification)
 *   DELETE /:id                  Revoke (soft delete)
 *
 * Access control:
 *   Reads  → org:read
 *   Writes → org:domain_manage
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../../observability/request-context';
import { VerifiedDomainsService } from './verified-domains.service';
import {
  RegisterDomainSchema,
  AdminOverrideSchema,
  type RegisterDomainDto,
  type AdminOverrideDto,
} from './dto/verified-domain.dto';

@Controller('organizations/:orgId/verified-domains')
export class VerifiedDomainsController {
  constructor(private readonly service: VerifiedDomainsService) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/organizations/:orgId/verified-domains
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('org:read')
  async list(@Param('orgId') orgId: string, @Req() req: Request) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const domains = await this.service.listByOrg(tenantId, orgId);
    return { data: domains, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:orgId/verified-domains
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('org:domain_manage')
  async register(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(RegisterDomainSchema)) dto: RegisterDomainDto,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const result = await this.service.register(tenantId, orgId, dto);

    return {
      data: {
        id: result.domain.id,
        domain: result.domain.domain,
        status: result.domain.status,
        includeSubdomains: result.domain.includeSubdomains,
        challenge: {
          recordName: result.recordName,
          recordValue: result.recordValue,
        },
      },
      traceId,
    };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:orgId/verified-domains/:id/verify
  // --------------------------------------------------------------------------

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:domain_manage')
  async verify(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { tenantId, userId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const domain = await this.service.verifyViaDns(tenantId, orgId, id, userId);

    return {
      data: {
        id: domain.id,
        status: domain.status,
        verifiedAt: domain.verifiedAt,
        verifiedVia: domain.verifiedVia,
      },
      traceId,
    };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:orgId/verified-domains/:id/override
  // --------------------------------------------------------------------------

  @Post(':id/override')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:domain_manage')
  async override(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminOverrideSchema)) dto: AdminOverrideDto,
    @Req() req: Request,
  ) {
    const { tenantId, userId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const domain = await this.service.adminOverride(tenantId, orgId, id, dto, userId);

    return {
      data: {
        id: domain.id,
        status: domain.status,
        verifiedAt: domain.verifiedAt,
        verifiedVia: domain.verifiedVia,
        verifiedBy: domain.verifiedBy,
      },
      traceId,
    };
  }

  // --------------------------------------------------------------------------
  // DELETE /api/v1/organizations/:orgId/verified-domains/:id
  // --------------------------------------------------------------------------

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:domain_manage')
  async revoke(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const domain = await this.service.revoke(tenantId, orgId, id);

    return {
      data: {
        id: domain.id,
        status: domain.status,
        revokedAt: domain.revokedAt,
      },
      traceId,
    };
  }
}
