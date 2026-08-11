/**
 * OrganizationsRepository — data access for the organizations table.
 *
 * Extends TenantRepository so all queries run inside the RLS-bound tenant
 * transaction. All write methods are decorated with @Auditable.
 *
 * Cross-cutting concerns:
 *   - Keyset pagination using (created_at DESC, id DESC) ordering.
 *   - Outbox events written in the same transaction as every mutation.
 *   - SQL wildcards in search terms are escaped before ILIKE.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, ilike, lt, or, sql } from 'drizzle-orm';
import {
  organizationsRegistry,
  outboxEvents,
  organizationVerifiedDomains,
  contacts,
  type OrganizationRegistry,
  type NewOrganizationRegistry,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { Auditable } from '../audit/auditable.decorator';
import { encodeCursor, decodeCursor } from './cursor';
import type { ListOrganizationsQuery } from './dto/list-organizations.query';

export interface OrganizationDetail extends OrganizationRegistry {
  verifiedDomainCount: number;
  contactCount: number;
}

export interface PaginatedOrganizations {
  data: OrganizationRegistry[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape SQL LIKE wildcards so user-supplied search terms match literally. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

@Injectable()
export class OrganizationsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findPaginated(
    tenantId: string,
    query: ListOrganizationsQuery,
  ): Promise<PaginatedOrganizations> {
    const { limit = 25, cursor, tier, region, status, q } = query;
    const fetchLimit = limit + 1; // fetch one extra to detect next page

    // Base conditions
    const conditions = [eq(organizationsRegistry.tenantId, tenantId)];

    // Filters
    if (tier) conditions.push(eq(organizationsRegistry.slaTier, tier));
    if (region) conditions.push(eq(organizationsRegistry.region, region));
    if (status) conditions.push(eq(organizationsRegistry.status, status));
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(
        or(
          ilike(organizationsRegistry.name, pattern),
          ilike(sql`COALESCE(${organizationsRegistry.slug}, '')`, pattern),
        ),
      );
    }

    // Keyset pagination: WHERE (created_at, id) < (cursor.createdAt, cursor.id)
    // Ordering is DESC so we use LT for the next page.
    if (cursor) {
      const pos = decodeCursor(cursor);
      if (!pos) throw Object.assign(new Error('Invalid pagination cursor'), { code: 'CURSOR_INVALID' });
      conditions.push(
        or(
          lt(organizationsRegistry.createdAt, pos.createdAt),
          and(
            eq(organizationsRegistry.createdAt, pos.createdAt),
            lt(organizationsRegistry.id, pos.id),
          ),
        ),
      );
    }

    const rows = await this.tx
      .select()
      .from(organizationsRegistry)
      .where(and(...conditions))
      .orderBy(
        sql`${organizationsRegistry.createdAt} DESC`,
        sql`${organizationsRegistry.id} DESC`,
      )
      .limit(fetchLimit);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = data[data.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
        : null;

    return { data, nextCursor };
  }

  async findById(tenantId: string, id: string): Promise<OrganizationRegistry | null> {
    const rows = await this.tx
      .select()
      .from(organizationsRegistry)
      .where(
        and(
          eq(organizationsRegistry.tenantId, tenantId),
          eq(organizationsRegistry.id, id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdWithDetail(tenantId: string, id: string): Promise<OrganizationDetail | null> {
    const org = await this.findById(tenantId, id);
    if (!org) return null;

    const [domainRows, contactRows] = await Promise.all([
      this.tx
        .select({ count: sql<number>`count(*)::int` })
        .from(organizationVerifiedDomains)
        .where(
          and(
            eq(organizationVerifiedDomains.tenantId, tenantId),
            eq(organizationVerifiedDomains.organizationId, id),
          ),
        ),
      this.tx
        .select({ count: sql<number>`count(*)::int` })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            eq(contacts.organizationId, id),
          ),
        ),
    ]);

    return {
      ...org,
      verifiedDomainCount: domainRows[0]?.count ?? 0,
      contactCount: contactRows[0]?.count ?? 0,
    };
  }

  async findByName(tenantId: string, name: string): Promise<OrganizationRegistry | null> {
    const rows = await this.tx
      .select()
      .from(organizationsRegistry)
      .where(
        and(
          eq(organizationsRegistry.tenantId, tenantId),
          sql`lower(${organizationsRegistry.name}) = lower(${name})`,
          eq(organizationsRegistry.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  @Auditable()
  async createOrganization(
    tenantId: string,
    data: Omit<NewOrganizationRegistry, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
    traceId?: string,
  ): Promise<OrganizationRegistry> {
    const rows = await this.tx
      .insert(organizationsRegistry)
      .values({
        ...data,
        tenantId,
        status: data.status ?? 'active',
        version: 1,
      })
      .returning();

    const created = rows[0]!;

    await this.emitOutboxEvent(tenantId, 'organization', created.id, 'organization.created', {
      name: created.name,
      slaTier: created.slaTier,
      region: created.region,
    }, traceId);

    return created;
  }

  @Auditable()
  async updateOrganization(
    tenantId: string,
    id: string,
    currentVersion: number,
    data: Partial<Pick<OrganizationRegistry, 'name' | 'slaTier' | 'region' | 'customFieldValues'>>,
    traceId?: string,
  ): Promise<OrganizationRegistry | 'VERSION_CONFLICT'> {
    const rows = await this.tx
      .update(organizationsRegistry)
      .set({
        ...data,
        version: sql`${organizationsRegistry.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(organizationsRegistry.tenantId, tenantId),
          eq(organizationsRegistry.id, id),
          eq(organizationsRegistry.version, currentVersion),
        ),
      )
      .returning();

    if (rows.length === 0) return 'VERSION_CONFLICT';

    const updated = rows[0]!;

    await this.emitOutboxEvent(tenantId, 'organization', id, 'organization.updated', {
      changedFields: Object.keys(data),
    }, traceId);

    return updated;
  }

  // --------------------------------------------------------------------------
  // Outbox helper
  // --------------------------------------------------------------------------

  private async emitOutboxEvent(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
    traceId?: string,
  ): Promise<void> {
    await this.tx
      .insert(outboxEvents)
      .values({
        tenantId,
        aggregateType,
        aggregateId,
        eventType,
        payload,
        traceId: traceId ?? null,
        status: 'pending',
      });
  }
}
