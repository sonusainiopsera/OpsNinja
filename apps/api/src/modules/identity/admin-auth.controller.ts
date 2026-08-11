/**
 * AdminAuthController
 *
 * POST /api/v1/admin/auth/unlock
 *   Clears the throttle lockout for an email address.
 *   Requires: admin:auth:unlock (administrator role).
 *   Request body: { email: string }
 *   Response: 204 No Content on success (even if no lockout existed).
 *   Writes an immutable audit record with the actor, tenant, and hashed subject.
 *
 * The unlock endpoint does NOT reveal whether a lockout existed — it always
 * returns 204 to avoid disclosing account state.  The audit record captures
 * the cleared TTL for operator inspection.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Request } from 'express';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { Permission } from '../../common/auth/permissions';
import { ThrottleService } from '../../common/security/throttle.service';
import { AuthAuditEmitter } from './services/auth-audit.emitter';
import { RequestContextStore } from '../../observability/request-context';

const UnlockBodySchema = z.object({
  email: z.string().email('email must be a valid email address'),
});

@Controller('admin/auth')
export class AdminAuthController {
  private readonly logger = new Logger(AdminAuthController.name);

  constructor(
    private readonly throttleService: ThrottleService,
    private readonly authAuditEmitter: AuthAuditEmitter,
  ) {}

  /**
   * POST /api/v1/admin/auth/unlock
   */
  @Post('unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ADMIN_AUTH_UNLOCK)
  async unlockEmail(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<void> {
    const parsed = UnlockBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        errors: parsed.error.errors,
      });
    }

    const { email } = parsed.data;
    const principal = RequestContextStore.getPrincipal();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    // Unlock email throttle (also clears IP hash if both are locked, but
    // IP unlocking requires a separate mechanism not exposed here).
    const clearedTtl = await this.throttleService.adminUnlock('email', email);

    const subjectHash = this.throttleService.hashSubject('email', email);

    this.logger.log({
      event: 'admin.auth.unlock',
      actorId: principal.userId,
      tenantId: principal.tenantId,
      subjectHash: subjectHash.slice(0, 12),
      clearedTtl,
      traceId,
    });

    await this.authAuditEmitter.emitAdminUnlock({
      actorId: principal.userId,
      tenantId: principal.tenantId,
      subjectHash: subjectHash.slice(0, 12),
      traceId,
    });
  }
}
