import { Injectable } from '@nestjs/common';
import { eq, and, or, inArray, sql } from 'drizzle-orm';
import { savedViews, savedViewPins } from '@opsninja/db';
import type { SavedView, NewSavedView, SavedViewPin } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class ViewsRepository extends TenantRepository {

  async listVisibleForUser(userId: string): Promise<(SavedView & { pin_order: number | null })[]> {
    const rows = await this.db
      .select({
        id: savedViews.id,
        tenantId: savedViews.tenantId,
        ownerUserId: savedViews.ownerUserId,
        name: savedViews.name,
        filterAst: savedViews.filterAst,
        sortSpec: savedViews.sortSpec,
        columns: savedViews.columns,
        scope: savedViews.scope,
        isActive: savedViews.isActive,
        astSignature: savedViews.astSignature,
        createdAt: savedViews.createdAt,
        updatedAt: savedViews.updatedAt,
        pin_order: savedViewPins.pinOrder,
      })
      .from(savedViews)
      .leftJoin(
        savedViewPins,
        and(
          eq(savedViewPins.viewId, savedViews.id),
          eq(savedViewPins.userId, userId),
        ),
      )
      .where(
        and(
          eq(savedViews.isActive, true),
          or(
            eq(savedViews.scope, 'system'),
            eq(savedViews.scope, 'shared'),
            and(
              eq(savedViews.scope, 'private'),
              eq(savedViews.ownerUserId, userId),
            ),
          ),
        ),
      );

    return rows as (SavedView & { pin_order: number | null })[];
  }

  async findById(id: string): Promise<SavedView | undefined> {
    const rows = await this.db
      .select()
      .from(savedViews)
      .where(eq(savedViews.id, id));
    return rows[0];
  }

  async findByIdVisible(id: string, userId: string): Promise<SavedView | undefined> {
    const rows = await this.db
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.id, id),
          eq(savedViews.isActive, true),
          or(
            eq(savedViews.scope, 'system'),
            eq(savedViews.scope, 'shared'),
            and(
              eq(savedViews.scope, 'private'),
              eq(savedViews.ownerUserId, userId),
            ),
          ),
        ),
      );
    return rows[0];
  }

  async findByNameForOwner(name: string, ownerUserId: string | null): Promise<SavedView | undefined> {
    const condition = ownerUserId === null
      ? and(eq(savedViews.isActive, true), sql`lower(${savedViews.name}) = lower(${name})`, sql`${savedViews.ownerUserId} IS NULL`)
      : and(eq(savedViews.isActive, true), sql`lower(${savedViews.name}) = lower(${name})`, eq(savedViews.ownerUserId, ownerUserId));

    const rows = await this.db
      .select()
      .from(savedViews)
      .where(condition);
    return rows[0];
  }

  async create(data: NewSavedView): Promise<SavedView> {
    const rows = await this.db
      .insert(savedViews)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async update(id: string, patch: Partial<Pick<SavedView, 'name' | 'filterAst' | 'sortSpec' | 'columns' | 'scope' | 'astSignature' | 'isActive'>>): Promise<SavedView | undefined> {
    const rows = await this.db
      .update(savedViews)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(savedViews.id, id))
      .returning();
    return rows[0];
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(savedViews)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(savedViews.id, id));
  }

  async getPinForUser(userId: string, viewId: string): Promise<SavedViewPin | undefined> {
    const rows = await this.db
      .select()
      .from(savedViewPins)
      .where(and(eq(savedViewPins.userId, userId), eq(savedViewPins.viewId, viewId)));
    return rows[0];
  }

  async upsertPin(tenantId: string, userId: string, viewId: string, pinOrder: number): Promise<void> {
    await this.db
      .insert(savedViewPins)
      .values({ tenantId, userId, viewId, pinOrder })
      .onConflictDoUpdate({
        target: [savedViewPins.tenantId, savedViewPins.userId, savedViewPins.viewId],
        set: { pinOrder, updatedAt: new Date() },
      });
  }

  async deletePin(userId: string, viewId: string): Promise<void> {
    await this.db
      .delete(savedViewPins)
      .where(and(eq(savedViewPins.userId, userId), eq(savedViewPins.viewId, viewId)));
  }

  async reorderPins(tenantId: string, userId: string, viewIds: string[]): Promise<void> {
    // Remove existing pins for this user that are in the provided list, then upsert
    if (viewIds.length === 0) return;

    for (let i = 0; i < viewIds.length; i++) {
      await this.db
        .insert(savedViewPins)
        .values({ tenantId, userId, viewId: viewIds[i]!, pinOrder: i })
        .onConflictDoUpdate({
          target: [savedViewPins.tenantId, savedViewPins.userId, savedViewPins.viewId],
          set: { pinOrder: i, updatedAt: new Date() },
        });
    }

    // Remove any pins for ids NOT in the payload
    await this.db
      .delete(savedViewPins)
      .where(
        and(
          eq(savedViewPins.userId, userId),
          eq(savedViewPins.tenantId, tenantId),
          sql`${savedViewPins.viewId} NOT IN ${sql`(${sql.join(viewIds.map(id => sql`${id}::uuid`), sql`, `)})`}`,
        ),
      );
  }

  async findSystemViewsBySlug(slugs: string[]): Promise<SavedView[]> {
    return this.db
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.scope, 'system'),
          inArray(savedViews.name, slugs),
        ),
      );
  }

  async countSystemViews(): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(savedViews)
      .where(eq(savedViews.scope, 'system'));
    return rows[0]?.count ?? 0;
  }
}
