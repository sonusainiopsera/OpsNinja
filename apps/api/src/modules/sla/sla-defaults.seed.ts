/**
 * Seed script for default SLA policies and calendars.
 *
 * Inserts provisional P1-P4 policies and two sample calendars.
 * All seed policies have targets_ratified=false (pending product sign-off).
 *
 * Must be called inside an active tenant transaction (TenantRepository pattern).
 * Idempotent: skips items that already exist.
 */

import { Injectable } from '@nestjs/common';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SlaCalendarsRepository } from './sla-calendars.repository';
import { RequestContextStore } from '../../observability/request-context';

export interface SlaDefaultSeedInput {
  tenantId: string;
  systemUserId: string;
}

/** Provisional response/resolution targets (unratified). Do not treat as contractual. */
const DEFAULT_POLICIES = [
  { priority: 'P1' as const, responseTargetMins: 15,  resolutionTargetMins: 240,  reminderPctFirst: 50, reminderPctSecond: 80 },
  { priority: 'P2' as const, responseTargetMins: 60,  resolutionTargetMins: 480,  reminderPctFirst: 50, reminderPctSecond: 80 },
  { priority: 'P3' as const, responseTargetMins: 240, resolutionTargetMins: 1440, reminderPctFirst: 60, reminderPctSecond: 85 },
  { priority: 'P4' as const, responseTargetMins: 480, resolutionTargetMins: 2880, reminderPctFirst: 60, reminderPctSecond: 85 },
];

@Injectable()
export class SlaDefaultsSeeder {
  constructor(
    private readonly policiesRepo: SlaPoliciesRepository,
    private readonly calendarsRepo: SlaCalendarsRepository,
  ) {}

  async seed(input: SlaDefaultSeedInput): Promise<void> {
    const { tenantId, systemUserId } = input;

    // ── Seed 24x7 calendar ──────────────────────────────────────────────────
    let twentyFourSeven = await this.calendarsRepo.findByName('24x7 Support');
    if (!twentyFourSeven) {
      twentyFourSeven = await this.calendarsRepo.create({
        tenantId,
        name: '24x7 Support',
        calendarType: 'twenty_four_seven',
        timezone: 'UTC',
        isActive: true,
        createdBy: systemUserId,
        updatedBy: systemUserId,
      });
    }

    // ── Seed business-hours calendar (Mon-Fri 09:00-17:00 UTC) ─────────────
    let businessHours = await this.calendarsRepo.findByName('Business Hours (Mon-Fri)');
    if (!businessHours) {
      businessHours = await this.calendarsRepo.create({
        tenantId,
        name: 'Business Hours (Mon-Fri)',
        calendarType: 'business_hours',
        timezone: 'UTC',
        isActive: true,
        createdBy: systemUserId,
        updatedBy: systemUserId,
      });

      // Mon=1 to Fri=5
      const windows = [1, 2, 3, 4, 5].map((weekday) => ({
        tenantId,
        calendarId: businessHours!.id,
        weekday,
        startLocalTime: '09:00:00',
        endLocalTime: '17:00:00',
      }));
      await this.calendarsRepo.createWindows(windows);

      // Sample holiday: New Year's Day 2026
      await this.calendarsRepo.createHolidays([
        { tenantId, calendarId: businessHours.id, holidayDate: '2026-01-01', label: "New Year's Day" },
      ]);
    }

    // ── Seed P1-P4 policies against 24x7 calendar ──────────────────────────
    for (const def of DEFAULT_POLICIES) {
      const existing = await this.policiesRepo.findActiveByScopeAndPriority('tenant', null, def.priority);
      if (existing) continue;

      const policy = await this.policiesRepo.create({
        tenantId,
        scopeType: 'tenant',
        scopeId: null,
        priority: def.priority,
        responseTargetMins: def.responseTargetMins,
        resolutionTargetMins: def.resolutionTargetMins,
        calendarId: twentyFourSeven.id,
        reminderPctFirst: def.reminderPctFirst,
        reminderPctSecond: def.reminderPctSecond,
        isActive: true,
        targetsRatified: false,
        version: 1,
        createdBy: systemUserId,
        updatedBy: systemUserId,
      });

      await this.policiesRepo.createVersion({
        tenantId,
        policyId: policy.id,
        version: 1,
        payload: def,
        changedBy: systemUserId,
      });
    }
  }
}
