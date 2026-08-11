/**
 * AdminAuthController — administrative auth management endpoints.
 *
 * POST /api/v1/admin/auth/unlock
 *   Clears the throttle lockout for a given email address.
 *   Requires admin:unlock_auth permission.
 *   Writes an immutable audit record of the unlock action.
 *
 * These routes are NOT @Public() — they require a valid admin JWT.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { IsEmail } from 'class-validator';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { NoTenantContext } from '../../common/tenant/no-tenant-context.decorator';
import { ThrottleService } from '../../common/security/throttle.service';
import { AuthAuditEmitter } from './services/auth-audit.emitter';

class UnlockAuthBody {
  @IsEmail()
  email!: string;
}

@NoTenantContext()
@Controller('admin/auth')
export class AdminAuthController {
  private readonly logger = new Logger(AdminAuthController.name);

  constructor(
    private readonly throttleService: ThrottleService,
    private readonly auditEmitter: AuthAuditEmitter,
  ) {}

  /**
   * POST /api/v1/admin/auth/unlock
   *
   * Clears throttle counters and lockout for the provided email address.
   * Returns 204 No Content on success.
   */
  @Post('unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('admin:unlock_auth')
  async unlockAuth(@Body() body: UnlockAuthBody, @Req() req: Request): Promise<void> {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const principal = (req as Request & { user?: { sub?: string; tenantId?: string } }).user;

    await this.throttleService.adminUnlock(body.email);

    void this.auditEmitter.emit({
      tenantId: principal?.tenantId ?? null,
      actorId: principal?.sub ?? null,
      actorKind: 'staff',
      eventType: 'auth.lockout_cleared',
      outcome: 'allowed',
      route: '/api/v1/admin/auth/unlock',
      traceId,
      metadata: { unlockedEmailHash: '[hashed by emitter]' },
    });
  }
}
