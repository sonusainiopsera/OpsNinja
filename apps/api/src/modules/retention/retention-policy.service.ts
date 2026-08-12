/**
 * RetentionPolicyService — WO-095.
 *
 * CRUD for retention_policies with:
 *   - Platform bounds validation (7–3650 days).
 *   - Hard 365-day floor for the 'audit_trail' category.
 *   - Startup consistency check: every category in the retention registry
 *     must have a configured policy, or the service fails fast on bootstrap.
 *
 * Security: tenant_id is always stamped from the authenticated principal;
 * the DTO cannot supply or override it.  Platform defaults (tenant_id = NULL)
 * are write-protected; they may only be set by platform operators.
 */

import { Injectable, OnModuleInit, UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { InjectPool } from '../../common/db/pool.token';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, isNull, or } from 'drizzle-orm';
import {
  retentionPolicies,
  RetentionPolicy,
  NewRetentionPolicy,
  RetentionPolicyMode,
} from '../../../../../../packages/db/src/schema/retention';
import { RETENTION_REGISTRY } from '../../../../../../packages/retention/src';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETENTION_DAYS_MIN   = 7;
const RETENTION_DAYS_MAX   = 3650;
const AUDIT_TRAIL_FLOOR    = 365;
const AUDIT_TRAIL_CATEGORY = 'audit_trail';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateRetentionPolicyDto {
  category:      string;
  retentionDays: number;
  mode?:         RetentionPolicyMode;
  createdBy?:    string;
}

export interface UpdateRetentionPolicyDto {
  retentionDays?: number;
  mode?:          RetentionPolicyMode;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class RetentionPolicyService implements OnModuleInit {
  private readonly db: NodePgDatabase;

  constructor(@InjectPool() pool: Pool) {
    this.db = drizzle(pool);
  }

  /**
   * OnModuleInit: fail fast if any registered category lacks a policy row.
   * Platform-default rows (tenant_id IS NULL) are the authoritative set.
   */
  async onModuleInit(): Promise<void> {
    const rows = await this.db
      .select({ category: retentionPolicies.category })
      .from(retentionPolicies)
      .where(isNull(retentionPolicies.tenantId));

    const configured = new Set(rows.map((r) => r.category));

    const missing = RETENTION_REGISTRY
      .filter((e) => e.strategy !== 'admin_action_only')
      .map((e) => e.table)
      .filter((t) => !configured.has(t));

    if (missing.length > 0) {
      throw new Error(
        `[RetentionPolicyService] Startup consistency check failed. ` +
        `The following categories have no platform-default retention policy: ` +
        missing.join(', ') + '. ' +
        `Seed migration or bootstrap must create a row in retention_policies for each.`,
      );
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async findAll(tenantId: string): Promise<RetentionPolicy[]> {
    return this.db
      .select()
      .from(retentionPolicies)
      .where(
        or(
          isNull(retentionPolicies.tenantId),
          eq(retentionPolicies.tenantId, tenantId),
        ),
      );
  }

  async findByCategory(tenantId: string, category: string): Promise<RetentionPolicy | null> {
    // Prefer tenant override; fall back to platform default.
    const rows = await this.db
      .select()
      .from(retentionPolicies)
      .where(
        and(
          eq(retentionPolicies.category, category),
          or(
            eq(retentionPolicies.tenantId, tenantId),
            isNull(retentionPolicies.tenantId),
          ),
        ),
      );

    const tenantOverride = rows.find((r) => r.tenantId === tenantId);
    const platformDefault = rows.find((r) => r.tenantId === null);
    return tenantOverride ?? platformDefault ?? null;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(tenantId: string | null, dto: CreateRetentionPolicyDto): Promise<RetentionPolicy> {
    this.validate(dto.category, dto.retentionDays);

    const row: NewRetentionPolicy = {
      tenantId,
      category:      dto.category,
      retentionDays: dto.retentionDays,
      mode:          dto.mode ?? 'dry_run',
      createdBy:     dto.createdBy ?? null,
    };

    const [created] = await this.db
      .insert(retentionPolicies)
      .values(row)
      .returning();

    return created!;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(
    id: string,
    tenantId: string | null,
    dto: UpdateRetentionPolicyDto,
  ): Promise<RetentionPolicy> {
    const existing = await this.db
      .select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.id, id))
      .then((rows) => rows[0] ?? null);

    if (!existing) {
      throw new NotFoundException({ error: { code: 'RETENTION_POLICY_NOT_FOUND' } });
    }

    if (tenantId !== null && existing.tenantId !== tenantId) {
      throw new NotFoundException({ error: { code: 'RETENTION_POLICY_NOT_FOUND' } });
    }

    const newDays = dto.retentionDays ?? existing.retentionDays;
    this.validate(existing.category, newDays);

    const [updated] = await this.db
      .update(retentionPolicies)
      .set({
        retentionDays: newDays,
        mode:          dto.mode ?? existing.mode,
        updatedAt:     new Date(),
      })
      .where(eq(retentionPolicies.id, id))
      .returning();

    return updated!;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private validate(category: string, retentionDays: number): void {
    if (retentionDays < RETENTION_DAYS_MIN || retentionDays > RETENTION_DAYS_MAX) {
      throw new UnprocessableEntityException({
        error: {
          code:    'RETENTION_DAYS_OUT_OF_BOUNDS',
          message: `retention_days must be between ${RETENTION_DAYS_MIN} and ${RETENTION_DAYS_MAX}`,
        },
      });
    }

    if (category === AUDIT_TRAIL_CATEGORY && retentionDays < AUDIT_TRAIL_FLOOR) {
      throw new UnprocessableEntityException({
        error: {
          code:    'AUDIT_TRAIL_FLOOR_VIOLATION',
          message: `audit_trail retention cannot be configured below ${AUDIT_TRAIL_FLOOR} days`,
        },
      });
    }
  }
}
