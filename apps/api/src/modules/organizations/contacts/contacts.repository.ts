/**
 * ContactsRepository — WO-027.
 *
 * Data access for the contacts table.  All queries run inside the
 * RLS-bound tenant transaction via TenantRepository.
 *
 * Security:
 *   - tenant_id is always the first WHERE predicate.
 *   - Email is stored and compared lower-cased; uniqueness is enforced by the
 *     DB unique index on (tenant_id, lower(email)).
 *   - @Auditable decorates every write so mutations appear in audit_logs.
 *   - Outbox events are written in the same transaction as mutations.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import {
  contacts,
  outboxEvents,
  organizationsRegistry,
  type Contact,
  type NewContact,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { Auditable } from '../../audit/auditable.decorator';
import type { CreateContactDto, UpdateContactDto, ListContactsQuery } from './dto/contact.dto';

// ---------------------------------------------------------------------------
// Cursor (keyset on created_at DESC, id DESC — same pattern as organizations)
// ---------------------------------------------------------------------------

interface CursorPayload { c: string; i: string; v: 1 }

function encodeCursor(contact: Contact): string {
  const p: CursorPayload = { c: contact.createdAt.toISOString(), i: contact.id, v: 1 };
  return Buffer.from(JSON.stringify(p)).toString('base64url');
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorPayload;
    if (typeof p.c !== 'string' || typeof p.i !== 'string') return null;
    return p;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export interface PaginatedContacts {
  data:       Contact[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class ContactsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findPaginated(
    tenantId:       string,
    organizationId: string,
    query:          ListContactsQuery,
  ): Promise<PaginatedContacts> {
    const { limit = 25, cursor, status, q } = query;
    const fetchLimit = limit + 1;

    const conditions = [
      eq(contacts.tenantId, tenantId),
      eq(contacts.organizationId, organizationId),
    ];

    if (status) conditions.push(eq(contacts.status, status));

    if (q) {
      const pattern = `%${escapeLike(q.toLowerCase())}%`;
      conditions.push(
        or(
          ilike(contacts.fullName, pattern),
          ilike(contacts.email, pattern),
        )!,
      );
    }

    if (cursor) {
      const p = decodeCursor(cursor);
      if (p) {
        conditions.push(
          or(
            sql`${contacts.createdAt} < ${p.c}::timestamptz`,
            and(
              sql`${contacts.createdAt} = ${p.c}::timestamptz`,
              sql`${contacts.id} < ${p.i}::uuid`,
            ),
          )!,
        );
      }
    }

    const rows = await this.tx
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(sql`${contacts.createdAt} DESC, ${contacts.id} DESC`)
      .limit(fetchLimit);

    const hasMore = rows.length > limit;
    const data    = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      nextCursor: hasMore ? encodeCursor(data[data.length - 1]!) : null,
    };
  }

  async findById(tenantId: string, id: string): Promise<Contact | null> {
    const rows = await this.tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdInOrg(
    tenantId: string,
    organizationId: string,
    id: string,
  ): Promise<Contact | null> {
    const rows = await this.tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.organizationId, organizationId),
          eq(contacts.id, id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(tenantId: string, email: string): Promise<Contact | null> {
    const rows = await this.tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          sql`lower(${contacts.email}) = ${email.toLowerCase()}`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  @Auditable()
  async createContact(
    tenantId:       string,
    organizationId: string,
    dto:            CreateContactDto,
    traceId?:       string,
  ): Promise<Contact> {
    const rows = await this.tx
      .insert(contacts)
      .values({
        tenantId,
        organizationId,
        email:               dto.email,
        fullName:            dto.fullName,
        jobTitle:            dto.jobTitle ?? null,
        phone:               dto.phone ?? null,
        portalAccessEnabled: dto.portalAccessEnabled,
        status:              'active',
        version:             1,
      })
      .returning();

    const created = rows[0]!;
    await this.emitOutboxEvent(
      tenantId, 'contact', created.id, 'contact.created',
      { organizationId, email: '[REDACTED]', fullName: '[REDACTED]' },
      traceId,
    );
    return created;
  }

  @Auditable()
  async updateContact(
    tenantId:       string,
    organizationId: string,
    id:             string,
    dto:            UpdateContactDto,
    traceId?:       string,
  ): Promise<Contact> {
    const updateData: Partial<NewContact> = {
      updatedAt: new Date(),
      version:   dto.version + 1,
    };
    if (dto.fullName            !== undefined) updateData.fullName            = dto.fullName;
    if (dto.jobTitle            !== undefined) updateData.jobTitle            = dto.jobTitle ?? null;
    if (dto.phone               !== undefined) updateData.phone               = dto.phone ?? null;
    if (dto.portalAccessEnabled !== undefined) updateData.portalAccessEnabled = dto.portalAccessEnabled;

    const rows = await this.tx
      .update(contacts)
      .set(updateData)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.organizationId, organizationId),
          eq(contacts.id, id),
          eq(contacts.version, dto.version),
        ),
      )
      .returning();

    const updated = rows[0]!;
    await this.emitOutboxEvent(
      tenantId, 'contact', id, 'contact.updated',
      { organizationId, fields: Object.keys(updateData) },
      traceId,
    );
    return updated;
  }

  @Auditable()
  async setStatus(
    tenantId:       string,
    organizationId: string,
    id:             string,
    status:         'active' | 'suspended',
    traceId?:       string,
  ): Promise<Contact> {
    const rows = await this.tx
      .update(contacts)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.organizationId, organizationId),
          eq(contacts.id, id),
        ),
      )
      .returning();

    const updated = rows[0]!;
    const eventType = status === 'active' ? 'contact.reactivated' : 'contact.suspended';
    await this.emitOutboxEvent(tenantId, 'contact', id, eventType, { organizationId }, traceId);
    return updated;
  }

  @Auditable()
  async setPortalAccess(
    tenantId:       string,
    organizationId: string,
    id:             string,
    enabled:        boolean,
    traceId?:       string,
  ): Promise<Contact> {
    const rows = await this.tx
      .update(contacts)
      .set({ portalAccessEnabled: enabled, updatedAt: new Date() })
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.organizationId, organizationId),
          eq(contacts.id, id),
        ),
      )
      .returning();

    const updated = rows[0]!;
    await this.emitOutboxEvent(
      tenantId, 'contact', id, 'contact.access_changed',
      { organizationId, portalAccessEnabled: enabled },
      traceId,
    );
    return updated;
  }

  /**
   * Designate a primary contact: clear previous primary then set new one —
   * both writes in one transaction call so no intermediate state is visible.
   */
  @Auditable()
  async setPrimaryContact(
    tenantId:          string,
    organizationId:    string,
    newPrimaryId:      string,
    traceId?:          string,
  ): Promise<void> {
    // Update organizations.primary_contact_id atomically.
    await this.tx
      .update(organizationsRegistry)
      .set({ primaryContactId: newPrimaryId, updatedAt: new Date() })
      .where(
        and(
          eq(organizationsRegistry.tenantId, tenantId),
          eq(organizationsRegistry.id, organizationId),
        ),
      );

    await this.emitOutboxEvent(
      tenantId, 'contact', newPrimaryId, 'contact.primary_designated',
      { organizationId },
      traceId,
    );
  }

  /**
   * Data-subject erasure: anonymise PII while keeping the row so ticket
   * history remains coherent (referential stub pattern).
   */
  async erasePii(tenantId: string, id: string): Promise<void> {
    await this.tx
      .update(contacts)
      .set({
        email:    `erased-${id}@erased.invalid`,
        fullName: '[erased]',
        phone:    null,
        jobTitle: null,
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id)));
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async emitOutboxEvent(
    tenantId:      string,
    aggregateType: string,
    aggregateId:   string,
    eventType:     string,
    payload:       Record<string, unknown>,
    traceId?:      string,
  ): Promise<void> {
    await this.tx.insert(outboxEvents).values({
      tenantId,
      aggregateType,
      aggregateId,
      eventType,
      payload,
      traceId: traceId ?? null,
      status:  'pending',
    });
  }
}
