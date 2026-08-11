/**
 * NotificationPreferencesController — WO-081.
 *
 * Two controllers in one file (portal + admin) as specified by the WO.
 *
 * Portal (contact-level):
 *   GET  /api/v1/portal/me/notification-preferences
 *   PUT  /api/v1/portal/me/notification-preferences
 *
 * Admin (org defaults):
 *   GET  /api/v1/organizations/:id/notification-defaults
 *   PUT  /api/v1/organizations/:id/notification-defaults
 *
 * Security:
 *  - Portal routes use @PortalRoute() — portal tokens only
 *  - Admin routes require 'admin:manage_tenant' permission (staff only)
 *  - 404 for organizations outside caller scope (prevents existence disclosure)
 *  - Every mutation writes an audit record via AuditWriter
 *  - 409 on optimistic-concurrency version mismatch
 *
 * Input validation: ZodValidationPipe with z.strict() schemas → 400 on unknown props.
 */

import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  UnauthorizedException,
  UseGuards,
  UsePipes,
} from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { PortalRoute } from '../../common/auth/portal-route.decorator';
import { PortalVisibilityGuard } from '../tickets/portal/portal-visibility.guard';
import { getPrincipalContext } from '../../observability/request-context';
import { assertPortalPrincipal } from '../identity/portal/portal-principal';
import { NotificationPreferencesService } from './notification-preferences.service';
import {
  UpdatePreferencesBodySchema,
  type UpdatePreferencesBodyDto,
  type PreferencesResponseDto,
} from './dto/notification-preferences.dto';
import { AuditWriter } from '../audit/audit-writer';

// ---------------------------------------------------------------------------
// ── Portal controller ────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

/**
 * Portal: /api/v1/portal/me/notification-preferences
 * Manages the authenticated portal contact's own notification preferences.
 */
@Controller('portal/me/notification-preferences')
@PortalRoute()
@UseGuards(PortalVisibilityGuard)
@RequirePermission('ticket:read')
export class PortalNotificationPreferencesController {
  constructor(
    private readonly prefsService: NotificationPreferencesService,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * GET /api/v1/portal/me/notification-preferences
   * Returns org defaults + per-contact overrides for the authenticated contact.
   */
  @Get()
  async getMyPreferences(): Promise<PreferencesResponseDto> {
    const ctx = getPrincipalContext();
    assertPortalPrincipal(ctx);

    const result = await this.prefsService.getContactPreferences(
      ctx.tenantId,
      ctx.userId,              // portal userId IS the contactId
      ctx.boundOrganizationId,
    );

    return { data: result };
  }

  /**
   * PUT /api/v1/portal/me/notification-preferences
   * Replaces the authenticated contact's preference overrides.
   * Body: { overrides: [...], version }
   * 409 on version mismatch, 400 on unknown eventType or unknown property.
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(UpdatePreferencesBodySchema))
  async updateMyPreferences(
    @Body() dto: UpdatePreferencesBodyDto,
  ): Promise<PreferencesResponseDto> {
    const ctx = getPrincipalContext();
    assertPortalPrincipal(ctx);

    // Optimistic concurrency: verify the version in the request matches current
    const current = await this.prefsService.getContactPreferences(
      ctx.tenantId,
      ctx.userId,
      ctx.boundOrganizationId,
    );

    if (current.version !== dto.version) {
      throw new ConflictException({
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Notification preferences were updated concurrently. Refresh and retry.',
          currentVersion: current.version,
        },
      });
    }

    const updated = await this.prefsService.upsertContactPreferences(
      ctx.tenantId,
      ctx.userId,
      ctx.boundOrganizationId,
      dto.overrides,
      ctx.userId,
    );

    // Write audit record
    await this.auditWriter.write({
      eventType: 'notification_preferences.updated',
      resourceType: 'notification_preferences',
      resourceId: ctx.userId,
      action: 'update',
      beforeState: { version: current.version, overrides: current.overrides },
      afterState: { version: updated.version, overrides: updated.overrides },
      changedFields: ['overrides'],
    });

    return { data: updated };
  }
}

// ---------------------------------------------------------------------------
// ── Admin controller ─────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

/**
 * Admin: /api/v1/organizations/:id/notification-defaults
 * Manages org-level notification defaults. Requires Support Administrator role.
 * 404 for organizations outside the caller's scope (prevents existence disclosure).
 */
@Controller('organizations/:id/notification-defaults')
@RequirePermission('admin:manage_tenant')
export class AdminNotificationDefaultsController {
  constructor(
    private readonly prefsService: NotificationPreferencesService,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * GET /api/v1/organizations/:id/notification-defaults
   * Returns the org-level default preferences for the organization.
   * 404 if org is outside the caller's tenant scope.
   */
  @Get()
  async getOrgDefaults(@Param('id') orgId: string): Promise<PreferencesResponseDto> {
    const ctx = getPrincipalContext();
    this.assertOrgInScope(ctx, orgId);

    const result = await this.prefsService.getOrganizationDefaults(
      ctx.tenantId,
      orgId,
    );

    return { data: result };
  }

  /**
   * PUT /api/v1/organizations/:id/notification-defaults
   * Replaces the org-level default preferences.
   * 409 on version mismatch, 400 on unknown eventType, 404 out-of-scope org.
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(UpdatePreferencesBodySchema))
  async updateOrgDefaults(
    @Param('id') orgId: string,
    @Body() dto: UpdatePreferencesBodyDto,
  ): Promise<PreferencesResponseDto> {
    const ctx = getPrincipalContext();
    this.assertOrgInScope(ctx, orgId);

    const current = await this.prefsService.getOrganizationDefaults(
      ctx.tenantId,
      orgId,
    );

    if (current.version !== dto.version) {
      throw new ConflictException({
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Organization notification defaults were updated concurrently. Refresh and retry.',
          currentVersion: current.version,
        },
      });
    }

    const updated = await this.prefsService.upsertOrganizationDefaults(
      ctx.tenantId,
      orgId,
      dto.overrides,
      ctx.userId,
    );

    await this.auditWriter.write({
      eventType: 'notification_defaults.updated',
      resourceType: 'notification_preferences',
      resourceId: orgId,
      action: 'update',
      beforeState: { version: current.version, defaults: current.defaults },
      afterState: { version: updated.version, defaults: updated.defaults },
      changedFields: ['defaults'],
    });

    return { data: updated };
  }

  /**
   * Org must be within the caller's tenant; returns 404 (not 403) to avoid
   * existence disclosure for out-of-scope organizations.
   */
  private assertOrgInScope(
    ctx: ReturnType<typeof getPrincipalContext>,
    orgId: string,
  ): void {
    // admin/manager roles have tenantWide scope (orgScopeIds empty → unrestricted)
    if (ctx.orgScopeIds.length > 0 && !ctx.orgScopeIds.includes(orgId)) {
      throw new NotFoundException({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Organization not found.',
        },
      });
    }
  }
}
