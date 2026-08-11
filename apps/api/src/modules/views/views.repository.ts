/**
 * Views repository — WO-039.
 *
 * All data access for saved_views and saved_view_pins goes through this class.
 * Uses the TenantRepository base so every query runs inside the RLS-bound
 * tenant transaction, enforcing row-level isolation automatically.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, or, isNull, sql } from 'drizzle-orm';
import {
  savedViews,
  savedViewPins,
  type SavedView,
  type NewSavedView,
  type SavedViewPin,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { Auditable } from '../audit/auditable.decorator';
import { seedSystemViews } from './system-views.seed';

@Injectable()
export class ViewsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Seeding
  // --------------------------------------------------------------------------

  async seedSystemViews(tenantId: string): Promise<void> {
    await seedSystemViews(this.tx, tenantId);
  }

  // --------------------------------------------------------------------------
  // saved_views reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<SavedView | null> {
    const rows = await this.tx
      .select()
      .from(savedViews)
      .where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Returns all views visible to the requesting agent:
   *   - scope='system' views
   *   - scope='shared' views
   *   - scope='private' views owned by this user
   */
  async findVisibleToUser(tenantId: string, userId: string): Promise<SavedView[]> {
    return this.tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.tenantId, tenantId),
          eq(savedViews.isActive, true),
          or(
            eq(savedViews.scope, 'system'),
            eq(savedViews.scope, 'shared'),
            and(eq(savedViews.scope, 'private'), eq(savedViews.ownerUserId, userId)),
          ),
        ),
      )
      .orderBy(savedViews.scope, savedViews.createdAt);
  }

  async findBySlug(tenantId: string, slug: string): Promise<SavedView | null> {
    const rows = await this.tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.tenantId, tenantId),
          eq(savedViews.slug, slug),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Checks for a name conflict within the scoping domain of a view.
   * Returns true if a view with the same lower-cased name already exists
   * for the same (tenant, owner) pairing (for private) or (tenant, null) for shared.
   */
  async nameConflictExists(
    tenantId: string,
    name: string,
    ownerUserId: string | null,
    excludeId?: string,
  ): Promise<boolean> {
    const conditions = [
      eq(savedViews.tenantId, tenantId),
      sql`lower(${savedViews.name}) = lower(${name})`,
      ownerUserId
        ? eq(savedViews.ownerUserId, ownerUserId)
        : isNull(savedViews.ownerUserId),
    ];
    if (excludeId) {
      conditions.push(sql`${savedViews.id} != ${excludeId}`);
    }
    const rows = await this.tx
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  // --------------------------------------------------------------------------
  // saved_views writes
  // --------------------------------------------------------------------------

  @Auditable({ resourceType: 'saved_view', action: 'create' })
  async create(data: NewSavedView): Promise<SavedView> {
    const rows = await this.tx
      .insert(savedViews)
      .values(data)
      .returning();
    return rows[0]!;
  }

  @Auditable({ resourceType: 'saved_view', action: 'update', resourceIdArg: 1 })
  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<NewSavedView, 'tenantId' | 'id'>>,
  ): Promise<SavedView | null> {
    const rows = await this.tx
      .update(savedViews)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  @Auditable({ resourceType: 'saved_view', action: 'delete', resourceIdArg: 1 })
  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .update(savedViews)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.id, id)))
      .returning({ id: savedViews.id });
    return rows.length > 0;
  }

  // --------------------------------------------------------------------------
  // saved_view_pins
  // --------------------------------------------------------------------------

  async findPinsForUser(tenantId: string, userId: string): Promise<SavedViewPin[]> {
    return this.tx
      .select()
      .from(savedViewPins)
      .where(
        and(eq(savedViewPins.tenantId, tenantId), eq(savedViewPins.userId, userId)),
      )
      .orderBy(savedViewPins.pinOrder);
  }

  async upsertPin(tenantId: string, userId: string, viewId: string, pinOrder: number): Promise<void> {
    await this.tx
      .insert(savedViewPins)
      .values({ tenantId, userId, viewId, pinOrder, pinnedAt: new Date() })
      .onConflictDoUpdate({
        target: [savedViewPins.tenantId, savedViewPins.userId, savedViewPins.viewId],
        set: { pinOrder },
      });
  }

  async deletePin(tenantId: string, userId: string, viewId: string): Promise<boolean> {
    const rows = await this.tx
      .delete(savedViewPins)
      .where(
        and(
          eq(savedViewPins.tenantId, tenantId),
          eq(savedViewPins.userId, userId),
          eq(savedViewPins.viewId, viewId),
        ),
      )
      .returning({ viewId: savedViewPins.viewId });
    return rows.length > 0;
  }

  /**
   * Batch upsert pin ordering. view_ids defines the new ordered list.
   * All entries are upserted in a single round-trip; order is 0-based index.
   * Unknown ids (not visible to user) are silently skipped — caller validates.
   */
  async batchUpsertPinOrder(
    tenantId: string,
    userId: string,
    viewIds: string[],
  ): Promise<void> {
    if (viewIds.length === 0) return;

    const values: Array<{ tenantId: string; userId: string; viewId: string; pinOrder: number; pinnedAt: Date }> =
      viewIds.map((viewId, idx) => ({
        tenantId,
        userId,
        viewId,
        pinOrder: idx,
        pinnedAt: new Date(),
      }));

    await this.tx
      .insert(savedViewPins)
      .values(values)
      .onConflictDoUpdate({
        target: [savedViewPins.tenantId, savedViewPins.userId, savedViewPins.viewId],
        set: {
          pinOrder: sql`EXCLUDED.pin_order`,
        },
      });
  }

  /**
   * Delete all pins for a user that are NOT in the provided view_ids list.
   * Called after batchUpsertPinOrder to clean up stale pins.
   */
  async deleteStaleUserPins(
    tenantId: string,
    userId: string,
    keepViewIds: string[],
  ): Promise<void> {
    if (keepViewIds.length === 0) {
      await this.tx
        .delete(savedViewPins)
        .where(
          and(
            eq(savedViewPins.tenantId, tenantId),
            eq(savedViewPins.userId, userId),
          ),
        );
      return;
    }

    await this.tx
      .delete(savedViewPins)
      .where(
        and(
          eq(savedViewPins.tenantId, tenantId),
          eq(savedViewPins.userId, userId),
          sql`${savedViewPins.viewId} NOT IN ${keepViewIds}`,
        ),
      );
  }
}
