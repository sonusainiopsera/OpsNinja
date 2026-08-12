/**
 * AdminPortalSignupsController — REST surface for the admin approval queue (WO-091).
 *
 * Routes:
 *   GET  /api/v1/admin/portal-signups           — paginated pending queue
 *   POST /api/v1/admin/portal-signups/:id/approve — approve a pending signup
 *   POST /api/v1/admin/portal-signups/:id/reject  — reject a pending signup
 *
 * All routes require portal_signup:review permission and run inside the
 * standard tenant-context interceptor.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { AdminPortalSignupsService, RejectReason } from './admin-portal-signups.service';
import type { ApproveSignupDto, RejectSignupDto, ListSignupsQuery } from './admin-portal-signups.service';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

class ApproveSignupBody implements ApproveSignupDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsBoolean()
  addVerifiedDomain?: boolean;
}

const REJECT_REASONS: RejectReason[] = [
  'not_a_customer',
  'unrecognised_domain',
  'duplicate_request',
  'security_concern',
  'other',
];

class RejectSignupBody implements RejectSignupDto {
  @IsIn(REJECT_REASONS)
  reason!: RejectReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  notifyApplicant?: boolean;
}

class ListSignupsQueryDto implements ListSignupsQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('admin/portal-signups')
export class AdminPortalSignupsController {
  private readonly logger = new Logger(AdminPortalSignupsController.name);

  constructor(private readonly service: AdminPortalSignupsService) {}

  /**
   * GET /api/v1/admin/portal-signups
   *
   * Returns paginated pending signup requests for the caller's tenant.
   * Restricted to portal_signup:review permission.
   */
  @Get()
  @RequirePermission('portal_signup:review')
  async list(
    @Query() query: ListSignupsQueryDto,
    @Req() req: Request,
  ) {
    const principal = this.extractPrincipal(req);
    return this.service.list(principal.tenantId, query);
  }

  /**
   * POST /api/v1/admin/portal-signups/:id/approve
   *
   * Approves a pending signup request, creates the portal user and routes
   * the appropriate follow-up (verification email or welcome email).
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('portal_signup:review')
  async approve(
    @Param('id') id: string,
    @Body() body: ApproveSignupBody,
    @Req() req: Request,
  ) {
    const principal = this.extractPrincipal(req);
    const traceId = this.extractTraceId(req);

    this.logger.log('[admin-signups] Approve request', {
      signupId: id,
      actorId: principal.sub,
      tenantId: principal.tenantId,
      traceId,
    });

    return this.service.approve(principal.tenantId, id, body, principal.sub);
  }

  /**
   * POST /api/v1/admin/portal-signups/:id/reject
   *
   * Rejects a pending signup request with an allow-listed reason.
   * Optionally sends a neutral non-disclosing notification to the applicant.
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('portal_signup:review')
  async reject(
    @Param('id') id: string,
    @Body() body: RejectSignupBody,
    @Req() req: Request,
  ) {
    const principal = this.extractPrincipal(req);
    const traceId = this.extractTraceId(req);

    this.logger.log('[admin-signups] Reject request', {
      signupId: id,
      actorId: principal.sub,
      tenantId: principal.tenantId,
      reason: body.reason,
      traceId,
    });

    return this.service.reject(principal.tenantId, id, body, principal.sub);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractPrincipal(req: Request): { sub: string; tenantId: string } {
    const user = (req as Request & { user?: { sub?: string; tenantId?: string } }).user;
    return {
      sub: user?.sub ?? randomUUID(),
      tenantId: user?.tenantId ?? '',
    };
  }

  private extractTraceId(req: Request): string {
    return (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
  }
}
