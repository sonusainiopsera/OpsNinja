/**
 * AiPolicyService — WO-063.
 *
 * Per-tenant AI policy enforcement and usage accounting for the core API.
 * Exposes:
 *   getSettings()   — read current settings for the calling tenant
 *   updateSettings() — mutate settings with optimistic-concurrency guard
 *   getUsage()       — read current/previous period usage
 *
 * The worker-side check+recordUsage path lives in DbAiPolicy (ai-synthesis
 * worker) and writes directly to the DB via raw SQL to avoid importing the
 * NestJS application layer.
 *
 * All DB access is through this.tx (TenantRepository) so RLS isolation is
 * guaranteed and every settings mutation is transactional with the audit record.
 */

import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';

import { tenantAiSettings, tenantAiUsage } from '@opsninja/db';
import type { TenantAiSettings, TenantAiUsage } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { AuditWriter } from '../audit/audit-writer';
import { getPrincipalContext } from '../../observability/request-context';

import type {
  AiSettingsResponse,
  UpdateAiSettingsDto,
  AiUsageResponse,
} from './dto/update-ai-settings.dto';

// ---------------------------------------------------------------------------
// Current-period helper (API-side)
// ---------------------------------------------------------------------------

function currentPeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function previousPeriod(): string {
  const now = new Date();
  let m = now.getUTCMonth(); // 0-indexed, so this is the *previous* month (1-indexed)
  let y = now.getUTCFullYear();
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AiPolicyService extends TenantRepository {
  private readonly logger = new Logger(AiPolicyService.name);

  constructor(private readonly auditWriter: AuditWriter) {
    super();
  }

  // --------------------------------------------------------------------------
  // Read settings
  // --------------------------------------------------------------------------

  async getSettings(): Promise<AiSettingsResponse> {
    const { tenantId } = getPrincipalContext();

    const rows = await this.tx
      .select()
      .from(tenantAiSettings)
      .where(eq(tenantAiSettings.tenantId, tenantId))
      .limit(1);

    // Default row when no explicit settings exist
    if (rows.length === 0) {
      return {
        aiEnabled:          true,
        monthlyTokenBudget: null,
        warnThresholdPct:   80,
        updatedAt:          new Date().toISOString(),
        version:            1,
      };
    }

    return mapSettings(rows[0]!);
  }

  // --------------------------------------------------------------------------
  // Update settings (optimistic concurrency via version)
  // --------------------------------------------------------------------------

  async updateSettings(dto: UpdateAiSettingsDto): Promise<AiSettingsResponse> {
    const { tenantId } = getPrincipalContext();

    // Read current state (or create defaults)
    const existing = await this.tx
      .select()
      .from(tenantAiSettings)
      .where(eq(tenantAiSettings.tenantId, tenantId))
      .limit(1);

    const before: TenantAiSettings | null = existing.length > 0 ? existing[0]! : null;
    const currentVersion = before?.version ?? 1;

    // Optimistic concurrency check
    if (dto.version !== currentVersion) {
      throw new ConflictException({
        error: {
          code:    'AI_SETTINGS_VERSION_CONFLICT',
          message: `Settings were modified concurrently. Expected version ${dto.version}, found ${currentVersion}.`,
          details: [{ currentVersion }],
        },
      });
    }

    const newVersion = currentVersion + 1;
    const now = new Date();

    // Upsert: create row with defaults merged with supplied values
    const upsertValues = {
      tenantId,
      aiEnabled:          dto.aiEnabled          ?? (before?.aiEnabled          ?? true),
      monthlyTokenBudget: dto.monthlyTokenBudget  !== undefined
        ? dto.monthlyTokenBudget
        : (before?.monthlyTokenBudget ?? null),
      warnThresholdPct:   dto.warnThresholdPct    ?? (before?.warnThresholdPct   ?? 80),
      warnedAt:           before?.warnedAt ?? null,
      version:            newVersion,
      updatedAt:          now,
    };

    await this.tx
      .insert(tenantAiSettings)
      .values(upsertValues)
      .onConflictDoUpdate({
        target: tenantAiSettings.tenantId,
        set: {
          aiEnabled:          upsertValues.aiEnabled,
          monthlyTokenBudget: upsertValues.monthlyTokenBudget,
          warnThresholdPct:   upsertValues.warnThresholdPct,
          version:            newVersion,
          updatedAt:          now,
        },
      });

    // Audit record — fail-closed
    await this.auditWriter.append({
      resourceType: 'tenant_ai_settings',
      resourceId:   tenantId,
      action:       'update',
      beforeState:  before ? { ...before, warnedAt: undefined } : null,
      afterState:   { ...upsertValues, warnedAt: undefined },
    });

    return {
      aiEnabled:          upsertValues.aiEnabled,
      monthlyTokenBudget: upsertValues.monthlyTokenBudget ?? null,
      warnThresholdPct:   upsertValues.warnThresholdPct,
      updatedAt:          now.toISOString(),
      version:            newVersion,
    };
  }

  // --------------------------------------------------------------------------
  // Usage read
  // --------------------------------------------------------------------------

  async getUsage(period?: string): Promise<AiUsageResponse> {
    const { tenantId } = getPrincipalContext();
    const targetPeriod = period ?? currentPeriod();

    const [usageRows, settingsRows] = await Promise.all([
      this.tx
        .select()
        .from(tenantAiUsage)
        .where(
          and(
            eq(tenantAiUsage.tenantId, tenantId),
            eq(tenantAiUsage.period, targetPeriod),
          ),
        )
        .limit(1),
      this.tx
        .select()
        .from(tenantAiSettings)
        .where(eq(tenantAiSettings.tenantId, tenantId))
        .limit(1),
    ]);

    const usage: TenantAiUsage | null = usageRows.length > 0 ? usageRows[0]! : null;
    const settings: TenantAiSettings | null = settingsRows.length > 0 ? settingsRows[0]! : null;

    const inputTokens         = usage?.inputTokens         ?? 0;
    const outputTokens        = usage?.outputTokens        ?? 0;
    const requestCount        = usage?.requestCount        ?? 0;
    const estimatedCostMicros = usage?.estimatedCostMicros ?? 0;

    const totalTokens         = inputTokens + outputTokens;
    const budget              = settings?.monthlyTokenBudget ?? null;

    const budgetUtilisationPct =
      budget && budget > 0
        ? Math.min(100, Math.round((totalTokens / budget) * 100))
        : null;

    return {
      period:               targetPeriod,
      inputTokens,
      outputTokens,
      requestCount,
      estimatedCostMicros,
      estimatedCostUsd:     estimatedCostMicros / 1_000_000,
      budgetUtilisationPct,
    };
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapSettings(row: TenantAiSettings): AiSettingsResponse {
  return {
    aiEnabled:          row.aiEnabled,
    monthlyTokenBudget: row.monthlyTokenBudget ?? null,
    warnThresholdPct:   row.warnThresholdPct,
    updatedAt:          row.updatedAt.toISOString(),
    version:            row.version,
  };
}
