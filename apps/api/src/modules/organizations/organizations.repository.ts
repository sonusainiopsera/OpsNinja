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
    const { limit = 25, cursor, tier, region, status, q, customField } = query;
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
    // JSONB containment filter via GIN index (WO-026)
    // Format: "fieldKey:value" → custom_field_values @> '{"fieldKey":"value"}'::jsonb
    if (customField) {
      const colonIdx = customField.indexOf(':');
      const cfKey = customField.slice(0, colonIdx);
      const cfVal = customField.slice(colonIdx + 1);
      const containsJson = JSON.stringify({ [cfKey]: cfVal });
      conditions.push(
        sql`${organizationsRegistry.customFieldValues} @> ${containsJson}::jsonb`,
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
  // Lifecycle: deactivate / reactivate
  // --------------------------------------------------------------------------

  /**
   * Returns true when the organization exists and is active.
   * Used by the tickets module to gate new ticket creation.
   */
  async isOrganizationActive(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .select({ status: organizationsRegistry.status })
      .from(organizationsRegistry)
      .where(
        and(
          eq(organizationsRegistry.tenantId, tenantId),
          eq(organizationsRegistry.id, id),
        ),
      )
      .limit(1);
    return rows.length > 0 && rows[0]!.status === 'active';
  }

  /**
   * Locks the organization row FOR UPDATE and deactivates it.
   *
   * Returns 'ALREADY_INACTIVE' for idempotency (caller returns 200).
   * Returns 'NOT_FOUND' when the row doesn't exist in this tenant.
   *
   * NOTE: Running SLA timers on in-flight tickets are intentionally NOT
   * touched here. Support obligations on open work survive the relationship
   * ending — pausing timers would penalise the customer unfairly.
   */
  @Auditable()
  async deactivateOrganization(
    tenantId: string,
    id: string,
    actorId: string,
    traceId?: string,
  ): Promise<OrganizationRegistry | 'ALREADY_INACTIVE' | 'NOT_FOUND'> {
    // Lock row for UPDATE to serialise concurrent deactivation requests
    const locked = await this.tx.execute(
      sql`SELECT id, status, name FROM organizations
          WHERE tenant_id = ${tenantId} AND id = ${id}
          FOR UPDATE`,
    );

    if ((locked as { rows: unknown[] }).rows.length === 0) return 'NOT_FOUND';
    const current = (locked as { rows: Array<{ status: string }> }).rows[0]!;
    if (current.status === 'inactive') return 'ALREADY_INACTIVE';

    // Update organization
    const rows = await this.tx
      .update(organizationsRegistry)
      .set({
        status: 'inactive',
        deactivatedAt: sql`now()`,
        deactivatedBy: actorId,
        version: sql`${organizationsRegistry.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(organizationsRegistry.tenantId, tenantId),
          eq(organizationsRegistry.id, id),
        ),
      )
      .returning();

    // Suspend portal access for all contacts in this org
    await this.tx
      .update(contacts)
      .set({ portalAccessEnabled: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.organizationId, id),
        ),
      );

    await this.emitOutboxEvent(
      tenantId,
      'organization',
      id,
      'organization.deactivated',
      { previousStatus: 'active', newStatus: 'inactive', actorId, occurredAt: new Date().toISOString() },
      traceId,
    );

    return rows[0]!;
  }

  /**
   * Locks the organization row FOR UPDATE and reactivates it.
   *
   * Returns 'ALREADY_ACTIVE' for idempotency (caller returns 200).
   * Returns 'NOT_FOUND' when the row doesn't exist in this tenant.
   * Caller is responsible for name-collision check before calling this.
   */
  @Auditable()
  async reactivateOrganization(
    tenantId: string,
    id: string,
    actorId: string,
    traceId?: string,
  ): Promise<OrganizationRegistry | 'ALREADY_ACTIVE' | 'NOT_FOUND'> {
    const locked = await this.tx.execute(
      sql`SELECT id, status FROM organizations
          WHERE tenant_id = ${tenantId} AND id = ${id}
          FOR UPDATE`,
    );

    if ((locked as { rows: unknown[] }).rows.length === 0) return 'NOT_FOUND';
    const current = (locked as { rows: Array<{ status: string }> }).rows[0]!;
    if (current.status === 'active') return 'ALREADY_ACTIVE';

    const rows = await this.tx
      .update(organizationsRegistry)
      .set({
        status: 'active',
        deactivatedAt: null,
        deactivatedBy: null,
        version: sql`${organizationsRegistry.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(organizationsRegistry.tenantId, tenantId),
          eq(organizationsRegistry.id, id),
        ),
      )
      .returning();

    await this.emitOutboxEvent(
      tenantId,
      'organization',
      id,
      'organization.reactivated',
      { previousStatus: 'inactive', newStatus: 'active', actorId, occurredAt: new Date().toISOString() },
      traceId,
    );

    return rows[0]!;
  }

  // --------------------------------------------------------------------------
  // Custom field values (WO-026)
  // --------------------------------------------------------------------------

  /**
   * Atomically replace an organization's custom_field_values with validated,
   * normalised values. Uses optimistic concurrency via the version column.
   *
   * Returns the updated org, or 'VERSION_CONFLICT' / 'NOT_FOUND'.
   */
  @Auditable()
  async putCustomFieldValues(
    tenantId: string,
    id: string,
    currentVersion: number,
    normalizedValues: Record<string, unknown>,
    traceId?: string,
  ): Promise<OrganizationRegistry | 'VERSION_CONFLICT' | 'NOT_FOUND'> {
    const rows = await this.tx
      .update(organizationsRegistry)
      .set({
        customFieldValues: normalizedValues,
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

    if (rows.length === 0) {
      // Could be not found or version conflict — check existence
      const exists = await this.findById(tenantId, id);
      return exists ? 'VERSION_CONFLICT' : 'NOT_FOUND';
    }

    await this.emitOutboxEvent(
      tenantId,
      'organization',
      id,
      'organization.custom_fields_updated',
      { fieldCount: Object.keys(normalizedValues).length },
      traceId,
    );

    return rows[0]!;
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
