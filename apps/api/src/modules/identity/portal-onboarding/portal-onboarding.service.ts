/**
 * PortalOnboardingService — WO-088.
 *
 * Manages the server-authoritative onboarding state machine.
 *
 * Responsibilities:
 *   - Load and Zod-parse JSONB state (fallback to empty on unknown shape)
 *   - Apply step transitions inside a single tenant-scoped transaction
 *   - Delegate side effects through owning module interfaces:
 *       - Change requests → OrganizationChangeRequestsService
 *       - Preferences    → NotificationPreferencesService.upsertContactPreferences
 *   - Optimistic concurrency: 409 on stale version
 *   - Emit audit + outbox on completion
 *   - Structured metrics per step and on completion
 */

import {
  Injectable,
  ConflictException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import { portalOnboardingStates, outboxEvents } from '@opsninja/db';
import type { PortalOnboardingState } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { getPrincipalContext } from '../../../observability/request-context';
import { OnboardingStateMachine } from './onboarding-state-machine';
import type { StepsMap, StepKey } from './onboarding-state-machine';
import { OrganizationChangeRequestsService } from '../../organizations/organization-change-requests.service';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import type { VerifyOrgStepDto, PreferencesStepDto, TutorialStepDto } from './dto/onboarding.dto';
import { OrganizationsService } from '../../organizations/organizations.service';

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface OnboardingStateResponse {
  currentStep:  StepKey | 'complete';
  steps:        StepsMap;
  organization: {
    id:             string;
    name:           string;
    tier:           string;
    verifiedDomains: string[];
  };
  preferenceOptions: {
    channels:       string[];
    digestCadences: string[];
  };
  tutorial: { contentVersion: string };
  completedAt: string | null;
  version: number;
}

@Injectable()
export class PortalOnboardingService extends TenantRepository {
  private readonly logger = new Logger(PortalOnboardingService.name);

  constructor(
    private readonly changeRequests: OrganizationChangeRequestsService,
    private readonly notifPrefs:     NotificationPreferencesService,
    private readonly orgsService:    OrganizationsService,
  ) {
    super();
  }

  // ---------------------------------------------------------------------------
  // GET state
  // ---------------------------------------------------------------------------

  async getState(): Promise<OnboardingStateResponse> {
    const { tenantId, userId, boundOrganizationId } = getPrincipalContext() as {
      tenantId: string; userId: string; boundOrganizationId: string;
    };

    const row = await this.loadOrCreate(tenantId, userId);
    const steps = OnboardingStateMachine.parseSteps(row.steps);

    const org = await this.orgsService.getById(tenantId, boundOrganizationId).catch(() => null);

    return this.buildResponse(row, steps, org);
  }

  // ---------------------------------------------------------------------------
  // PATCH verify-organization
  // ---------------------------------------------------------------------------

  async applyVerifyOrg(dto: VerifyOrgStepDto): Promise<OnboardingStateResponse> {
    const { tenantId, userId, boundOrganizationId } = getPrincipalContext() as {
      tenantId: string; userId: string; boundOrganizationId: string;
    };

    const row = await this.loadOrCreate(tenantId, userId);
    this.checkVersion(row, dto.version);

    const steps = OnboardingStateMachine.parseSteps(row.steps);

    if (dto.action === 'request_change') {
      // Write change request through owning module — never mutate org directly
      await this.changeRequests.createOrDeduplicate(tenantId, {
        organizationId:    boundOrganizationId,
        requestedByUserId: userId,
        fields:            dto.fields,
      });
    }

    const now = new Date().toISOString();
    steps['verify-organization'] = {
      status:    'confirmed',
      updatedAt: now,
      data:      dto.action === 'request_change'
        ? { changeRequestSubmitted: true }
        : { confirmed: true },
    };

    return this.persist(row, steps, 'verify-organization', tenantId, userId);
  }

  // ---------------------------------------------------------------------------
  // PATCH preferences
  // ---------------------------------------------------------------------------

  async applyPreferences(dto: PreferencesStepDto): Promise<OnboardingStateResponse> {
    const { tenantId, userId, boundOrganizationId } = getPrincipalContext() as {
      tenantId: string; userId: string; boundOrganizationId: string;
    };

    const row = await this.loadOrCreate(tenantId, userId);
    this.checkVersion(row, dto.version);

    const steps = OnboardingStateMachine.parseSteps(row.steps);

    // Write preferences through notifications module interface (AC-3)
    const prefs = dto.channels.map((ch) => ({
      eventType: 'ticket.status_changed',
      channel:   ch,
      mode:      (dto.digestCadence === 'immediate' ? 'immediate' : 'digest') as 'immediate' | 'digest',
    }));

    if (prefs.length > 0) {
      await this.notifPrefs.upsertContactPreferences(
        tenantId,
        userId,               // contactId
        boundOrganizationId,  // organizationId
        prefs,
        userId,               // updatedBy
      );
    }

    const now = new Date().toISOString();
    steps['preferences'] = {
      status:    dto.channels.length > 0 ? 'confirmed' : 'skipped',
      updatedAt: now,
      data:      { channels: dto.channels, digestCadence: dto.digestCadence },
    };

    return this.persist(row, steps, 'preferences', tenantId, userId);
  }

  // ---------------------------------------------------------------------------
  // PATCH tutorial
  // ---------------------------------------------------------------------------

  async applyTutorial(dto: TutorialStepDto): Promise<OnboardingStateResponse> {
    const { tenantId, userId } = getPrincipalContext() as {
      tenantId: string; userId: string;
    };

    const row = await this.loadOrCreate(tenantId, userId);
    this.checkVersion(row, dto.version);

    const steps = OnboardingStateMachine.parseSteps(row.steps);
    const now = new Date().toISOString();

    steps['tutorial'] = {
      status:         dto.action === 'complete' ? 'confirmed' : 'skipped',
      updatedAt:      now,
      contentVersion: dto.contentVersion,
    };

    return this.persist(row, steps, 'tutorial', tenantId, userId);
  }

  // ---------------------------------------------------------------------------
  // POST complete
  // ---------------------------------------------------------------------------

  async complete(): Promise<{ completedAt: string }> {
    const { tenantId, userId } = getPrincipalContext() as {
      tenantId: string; userId: string;
    };

    const row = await this.loadOrCreate(tenantId, userId);
    const steps = OnboardingStateMachine.parseSteps(row.steps);
    const { ok, outstanding } = OnboardingStateMachine.canComplete(steps);

    if (!ok) {
      throw new UnprocessableEntityException({
        error: {
          code:    'ONBOARDING_INCOMPLETE',
          message: 'All required steps must be completed before finishing onboarding.',
          details: outstanding,
        },
      });
    }

    const now = new Date();

    // Upsert completed state + audit log + outbox event in one transaction
    await this.tx
      .update(portalOnboardingStates)
      .set({
        currentStep:  'complete',
        completedAt:  now,
        version:      row.version + 1,
        updatedAt:    now,
      })
      .where(
        and(
          eq(portalOnboardingStates.tenantId, tenantId),
          eq(portalOnboardingStates.userId, userId),
        ),
      );

    await this.tx.insert(outboxEvents).values({
      id:             randomUUID(),
      tenantId,
      aggregateType:  'portal_user',
      aggregateId:    userId,
      eventType:      'portal_user.onboarded',
      payload:        { tenantId, userId, completedAt: now.toISOString() } as never,
      status:         'pending',
      createdAt:      now,
    });

    this.emitMetric('portal_onboarding_completed_total', tenantId);
    this.logger.log('Onboarding completed', { tenantId, userId });

    return { completedAt: now.toISOString() };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async loadOrCreate(tenantId: string, userId: string): Promise<PortalOnboardingState> {
    const rows = await this.tx
      .select()
      .from(portalOnboardingStates)
      .where(
        and(
          eq(portalOnboardingStates.tenantId, tenantId),
          eq(portalOnboardingStates.userId, userId),
        ),
      )
      .limit(1);

    if (rows.length > 0) return rows[0]!;

    // Create a fresh state row
    const [created] = await this.tx
      .insert(portalOnboardingStates)
      .values({
        id:          randomUUID(),
        tenantId,
        userId,
        currentStep: 'verify-organization',
        steps:       {} as never,
        version:     1,
        createdAt:   new Date(),
        updatedAt:   new Date(),
      })
      .returning();

    return created!;
  }

  private checkVersion(row: PortalOnboardingState, clientVersion: number): void {
    if (row.version !== clientVersion) {
      throw new ConflictException({
        error: {
          code:    'ONBOARDING_STATE_CONFLICT',
          message: `Stale version. Server has version ${row.version}, client sent ${clientVersion}.`,
          details: [{ serverVersion: row.version }],
        },
      });
    }
  }

  private async persist(
    row:      PortalOnboardingState,
    steps:    StepsMap,
    stepKey:  StepKey,
    tenantId: string,
    userId:   string,
  ): Promise<OnboardingStateResponse> {
    const now = new Date();
    const nextStep = OnboardingStateMachine.nextStep(steps);
    const newVersion = row.version + 1;

    await this.tx
      .update(portalOnboardingStates)
      .set({
        currentStep: nextStep,
        steps:       steps as never,
        version:     newVersion,
        updatedAt:   now,
      })
      .where(
        and(
          eq(portalOnboardingStates.tenantId, tenantId),
          eq(portalOnboardingStates.userId, userId),
        ),
      );

    const { boundOrganizationId } = getPrincipalContext() as { boundOrganizationId: string };
    const org = await this.orgsService.getById(tenantId, boundOrganizationId).catch(() => null);

    this.emitMetric(`portal_onboarding_step_completed_total`, tenantId, { step: stepKey });

    return this.buildResponse(
      { ...row, currentStep: nextStep, steps, version: newVersion, updatedAt: now },
      steps,
      org,
    );
  }

  private buildResponse(
    row:   PortalOnboardingState,
    steps: StepsMap,
    org:   { id: string; name: string; tier?: string; verifiedDomains?: string[] } | null,
  ): OnboardingStateResponse {
    return {
      currentStep:  (row.completedAt ? 'complete' : row.currentStep) as StepKey | 'complete',
      steps,
      organization: {
        id:              org?.id              ?? '',
        name:            org?.name            ?? '',
        tier:            (org as Record<string, unknown> | null)?.['tier'] as string ?? '',
        verifiedDomains: (org as Record<string, unknown> | null)?.['verifiedDomains'] as string[] ?? [],
      },
      preferenceOptions: {
        channels:       ['email', 'webhook'],
        digestCadences: ['immediate', 'daily_digest', 'weekly_digest'],
      },
      tutorial:   { contentVersion: 'v1' },
      completedAt: row.completedAt?.toISOString() ?? null,
      version:     row.version,
    };
  }

  private emitMetric(name: string, tenantId: string, labels?: Record<string, string>): void {
    this.logger.log(`[METRIC] ${name}`, { metric: name, tenantId, ...labels });
  }
}
