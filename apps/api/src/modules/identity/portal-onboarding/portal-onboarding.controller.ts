/**
 * PortalOnboardingController — WO-088.
 *
 * Serves the guided onboarding wizard for newly verified portal users.
 *
 * Routes (all @PortalRoute, all require portal_user role):
 *   GET  /api/v1/portal/onboarding              — current state (resumable)
 *   PATCH /api/v1/portal/onboarding/steps/verify-organization
 *   PATCH /api/v1/portal/onboarding/steps/preferences
 *   PATCH /api/v1/portal/onboarding/steps/tutorial
 *   POST  /api/v1/portal/onboarding/complete
 *
 * All write routes validate a version field for optimistic concurrency.
 * 409 ONBOARDING_STATE_CONFLICT is returned on stale version.
 * 422 ONBOARDING_INCOMPLETE is returned when complete() called prematurely.
 */

import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { PortalRoute } from '../../../common/auth/portal-route.decorator';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PortalVisibilityGuard } from '../../tickets/portal/portal-visibility.guard';
import { PortalOnboardingService } from './portal-onboarding.service';
import {
  VerifyOrgStepSchema,
  PreferencesStepSchema,
  TutorialStepSchema,
  type VerifyOrgStepDto,
  type PreferencesStepDto,
  type TutorialStepDto,
} from './dto/onboarding.dto';

@Controller('portal/onboarding')
@PortalRoute()
@UseGuards(PortalVisibilityGuard)
@RequirePermission('ticket:read') // portal_user role carries this; used as audience marker
export class PortalOnboardingController {
  private readonly logger = new Logger(PortalOnboardingController.name);

  constructor(private readonly service: PortalOnboardingService) {}

  // --------------------------------------------------------------------------
  // GET state
  // --------------------------------------------------------------------------

  @Get()
  async getState(@Req() req: Request) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.service.getState();
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // PATCH verify-organization
  // --------------------------------------------------------------------------

  @Patch('steps/verify-organization')
  @HttpCode(HttpStatus.OK)
  async verifyOrg(
    @Body(new ZodValidationPipe(VerifyOrgStepSchema)) dto: VerifyOrgStepDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.service.applyVerifyOrg(dto);
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // PATCH preferences
  // --------------------------------------------------------------------------

  @Patch('steps/preferences')
  @HttpCode(HttpStatus.OK)
  async preferences(
    @Body(new ZodValidationPipe(PreferencesStepSchema)) dto: PreferencesStepDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.service.applyPreferences(dto);
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // PATCH tutorial
  // --------------------------------------------------------------------------

  @Patch('steps/tutorial')
  @HttpCode(HttpStatus.OK)
  async tutorial(
    @Body(new ZodValidationPipe(TutorialStepSchema)) dto: TutorialStepDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.service.applyTutorial(dto);
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // POST complete
  // --------------------------------------------------------------------------

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Req() req: Request) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.service.complete();
    return { data, traceId };
  }
}
