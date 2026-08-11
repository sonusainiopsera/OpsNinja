/**
 * SLA default seed — WO-044.
 *
 * Inserts provisional P1–P4 policy defaults and two sample calendars for a
 * given tenant. All policies are flagged targets_ratified=false (unratified)
 * so the UI can badge them as provisional pending product sign-off.
 *
 * Uses ON CONFLICT DO NOTHING keyed on the active-scope-priority unique index
 * so re-running the seed is idempotent.
 *
 * NOTE: target minute values below are placeholders — they must be reviewed and
 * ratified by product before production use (targets_ratified=false guards this).
 *
 * P1 — Critical incident
 * P2 — High-impact issue
 * P3 — Standard request
 * P4 — Low-priority request
 */

import type { TxHandle } from '@opsninja/db';
import { slaPolicies, slaCalendars, slaCalendarWindows } from '@opsninja/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

interface SeedOptions {
  tenantId: string;
  actorId: string;
}

export async function seedSlaDefaults(
  tx: TxHandle,
  opts: SeedOptions,
): Promise<void> {
  const { tenantId, actorId } = opts;

  // ── 1. Calendars ──────────────────────────────────────────────────────────

  const twentyFourSevenId = randomUUID();
  const businessHoursId = randomUUID();

  await tx
    .insert(slaCalendars)
    .values([
      {
        id: twentyFourSevenId,
        tenantId,
        name: '24×7 All-Hours',
        calendarType: 'twenty_four_seven',
        timezone: 'UTC',
        isActive: true,
      },
      {
        id: businessHoursId,
        tenantId,
        name: 'Business Hours (Mon–Fri 09:00–17:00 UTC)',
        calendarType: 'business_hours',
        timezone: 'UTC',
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  // Business-hours windows: Mon (0) through Fri (4), 09:00–17:00
  const businessWindows = [0, 1, 2, 3, 4].map((weekday) => ({
    id: randomUUID(),
    tenantId,
    calendarId: businessHoursId,
    weekday,
    startLocalTime: '09:00',
    endLocalTime: '17:00',
  }));

  if (businessWindows.length > 0) {
    await tx
      .insert(slaCalendarWindows)
      .values(businessWindows)
      .onConflictDoNothing();
  }

  // ── 2. Policies ───────────────────────────────────────────────────────────

  // P1 and P2 use 24×7; P3 and P4 use business hours.
  // Targets are unratified provisional defaults.
  const policies = [
    {
      priority: 'P1',
      responseTargetMins: 60,      // 1 hour
      resolutionTargetMins: 240,   // 4 hours
      calendarId: twentyFourSevenId,
    },
    {
      priority: 'P2',
      responseTargetMins: 240,     // 4 hours
      resolutionTargetMins: 1440,  // 24 hours (1 day)
      calendarId: twentyFourSevenId,
    },
    {
      priority: 'P3',
      responseTargetMins: 480,     // 8 business hours
      resolutionTargetMins: 5760,  // 4 business days
      calendarId: businessHoursId,
    },
    {
      priority: 'P4',
      responseTargetMins: 2880,    // ~3 business days (first response)
      resolutionTargetMins: 14400, // ~10 business days
      calendarId: businessHoursId,
    },
  ] as const;

  for (const p of policies) {
    await tx
      .insert(slaPolicies)
      .values({
        id: randomUUID(),
        tenantId,
        scopeType: 'tenant',
        scopeId: null,
        priority: p.priority,
        responseTargetMins: p.responseTargetMins,
        resolutionTargetMins: p.resolutionTargetMins,
        calendarId: p.calendarId,
        reminderPctFirst: 50,
        reminderPctSecond: 75,
        isActive: true,
        targetsRatified: false,
        version: 1,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .onConflictDoNothing();
  }
}
