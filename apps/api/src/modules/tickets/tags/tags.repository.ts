/**
 * TagsRepository — all direct database operations for tags and ticket_tags.
 *
 * Design notes:
 *  - createOrReturn uses INSERT … ON CONFLICT DO NOTHING + SELECT to make
 *    concurrent tag creation safe without pre-check races.
 *  - merge is intentionally NOT a method here; it belongs in the service
 *    layer so it can be wrapped in a transaction.
 *  - usage_count is maintained by the service via increment/decrement rather
 *    than triggers, keeping schema compatibility without PG trigger overhead.
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagRecord {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  colour: string | null;
  isActive: boolean;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTagParams {
  tenantId: string;
  name: string;
  slug: string;
  colour?: string | null;
}

export interface UpdateTagParams {
  name?: string;
  slug?: string;
  colour?: string | null;
  isActive?: boolean;
}

export interface TicketTagRecord {
  tenantId: string;
  ticketId: string;
  tagId: string;
  attachedAt: Date;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class TagsRepository {
  // -------------------------------------------------------------------------
  // Tag CRUD
  // -------------------------------------------------------------------------

  async findAll(sql: Sql, tenantId: string, includeInactive = false): Promise<TagRecord[]> {
    type Row = {
      id: string; tenant_id: string; name: string; slug: string;
      colour: string | null; is_active: boolean; usage_count: number;
      created_at: Date; updated_at: Date;
    };
    const rows = await sql<Row[]>`
      SELECT id, tenant_id, name, slug, colour, is_active, usage_count, created_at, updated_at
      FROM tags
      WHERE tenant_id = ${tenantId}::uuid
        ${includeInactive ? sql`` : sql`AND is_active = true`}
      ORDER BY name ASC
    `;
    return rows.map(rowToRecord);
  }

  async findById(sql: Sql, tenantId: string, id: string): Promise<TagRecord | null> {
    type Row = {
      id: string; tenant_id: string; name: string; slug: string;
      colour: string | null; is_active: boolean; usage_count: number;
      created_at: Date; updated_at: Date;
    };
    const rows = await sql<Row[]>`
      SELECT id, tenant_id, name, slug, colour, is_active, usage_count, created_at, updated_at
      FROM tags
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    `;
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async findBySlug(sql: Sql, tenantId: string, slug: string): Promise<TagRecord | null> {
    type Row = {
      id: string; tenant_id: string; name: string; slug: string;
      colour: string | null; is_active: boolean; usage_count: number;
      created_at: Date; updated_at: Date;
    };
    const rows = await sql<Row[]>`
      SELECT id, tenant_id, name, slug, colour, is_active, usage_count, created_at, updated_at
      FROM tags
      WHERE tenant_id = ${tenantId}::uuid AND slug = ${slug}
    `;
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async countActive(sql: Sql, tenantId: string): Promise<number> {
    const rows = await sql<[{ count: string }]>`
      SELECT COUNT(*) AS count FROM tags WHERE tenant_id = ${tenantId}::uuid AND is_active = true
    `;
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  /**
   * Inserts a new tag. Returns null when the slug already exists
   * (ON CONFLICT DO NOTHING). Callers should fall back to findBySlug.
   */
  async create(sql: Sql, params: CreateTagParams): Promise<TagRecord | null> {
    type Row = {
      id: string; tenant_id: string; name: string; slug: string;
      colour: string | null; is_active: boolean; usage_count: number;
      created_at: Date; updated_at: Date;
    };
    const rows = await sql<Row[]>`
      INSERT INTO tags (tenant_id, name, slug, colour)
      VALUES (${params.tenantId}::uuid, ${params.name}, ${params.slug}, ${params.colour ?? null})
      ON CONFLICT DO NOTHING
      RETURNING id, tenant_id, name, slug, colour, is_active, usage_count, created_at, updated_at
    `;
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async update(
    sql: Sql,
    tenantId: string,
    id: string,
    params: UpdateTagParams,
  ): Promise<TagRecord | null> {
    // Build dynamic SET clause.
    const setClauses: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    let idx = 1;

    if (params.name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(params.name); }
    if (params.slug !== undefined) { setClauses.push(`slug = $${idx++}`); values.push(params.slug); }
    if (params.colour !== undefined) { setClauses.push(`colour = $${idx++}`); values.push(params.colour); }
    if (params.isActive !== undefined) { setClauses.push(`is_active = $${idx++}`); values.push(params.isActive); }

    if (values.length === 0) return this.findById(sql, tenantId, id);

    values.push(tenantId, id);
    const tenantIdx = idx++;
    const idIdx = idx;

    type Row = {
      id: string; tenant_id: string; name: string; slug: string;
      colour: string | null; is_active: boolean; usage_count: number;
      created_at: Date; updated_at: Date;
    };
    const rows = await sql.unsafe<Row[]>(
      `UPDATE tags SET ${setClauses.join(', ')}
       WHERE tenant_id = $${tenantIdx}::uuid AND id = $${idIdx}::uuid
       RETURNING id, tenant_id, name, slug, colour, is_active, usage_count, created_at, updated_at`,
      values,
    );
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async incrementUsageCount(sql: Sql, tenantId: string, tagId: string, delta: number): Promise<void> {
    await sql`
      UPDATE tags
      SET usage_count = GREATEST(0, usage_count + ${delta}),
          updated_at  = now()
      WHERE tenant_id = ${tenantId}::uuid AND id = ${tagId}::uuid
    `;
  }

  // -------------------------------------------------------------------------
  // Ticket tags
  // -------------------------------------------------------------------------

  /** Returns the tag IDs attached to a ticket. */
  async findTicketTags(sql: Sql, tenantId: string, ticketId: string): Promise<string[]> {
    const rows = await sql<[{ tag_id: string }]>`
      SELECT tag_id FROM ticket_tags
      WHERE tenant_id = ${tenantId}::uuid AND ticket_id = ${ticketId}::uuid
      ORDER BY attached_at ASC
    `;
    return rows.map((r) => r.tag_id);
  }

  /**
   * Attaches a tag to a ticket. Returns true if a new row was created,
   * false if it was already attached (ON CONFLICT DO NOTHING).
   */
  async attachTag(
    sql: Sql,
    tenantId: string,
    ticketId: string,
    tagId: string,
  ): Promise<boolean> {
    const rows = await sql`
      INSERT INTO ticket_tags (tenant_id, ticket_id, tag_id)
      VALUES (${tenantId}::uuid, ${ticketId}::uuid, ${tagId}::uuid)
      ON CONFLICT DO NOTHING
      RETURNING tag_id
    `;
    return rows.length > 0;
  }

  /**
   * Detaches a tag from a ticket. Returns true if a row was deleted,
   * false if it was not attached.
   */
  async detachTag(
    sql: Sql,
    tenantId: string,
    ticketId: string,
    tagId: string,
  ): Promise<boolean> {
    const rows = await sql`
      DELETE FROM ticket_tags
      WHERE tenant_id = ${tenantId}::uuid
        AND ticket_id = ${ticketId}::uuid
        AND tag_id    = ${tagId}::uuid
      RETURNING tag_id
    `;
    return rows.length > 0;
  }

  /**
   * Remaps all ticket_tags rows from sourceTagId to targetTagId in a single
   * statement. Rows where the ticket already carries targetTagId are silently
   * dropped via ON CONFLICT DO NOTHING. Returns the number of tickets remapped.
   */
  async mergeTicketTags(
    sql: Sql,
    tenantId: string,
    sourceTagId: string,
    targetTagId: string,
  ): Promise<number> {
    const rows = await sql`
      INSERT INTO ticket_tags (tenant_id, ticket_id, tag_id)
      SELECT tenant_id, ticket_id, ${targetTagId}::uuid
      FROM ticket_tags
      WHERE tenant_id = ${tenantId}::uuid AND tag_id = ${sourceTagId}::uuid
      ON CONFLICT DO NOTHING
      RETURNING ticket_id
    `;
    const remapped = rows.length;

    // Delete source rows (including any that were skipped by ON CONFLICT).
    await sql`
      DELETE FROM ticket_tags
      WHERE tenant_id = ${tenantId}::uuid AND tag_id = ${sourceTagId}::uuid
    `;

    return remapped;
  }

  /** Count of tickets carrying a tag (for usage count sync and audit). */
  async countTicketsByTag(sql: Sql, tenantId: string, tagId: string): Promise<number> {
    const rows = await sql<[{ count: string }]>`
      SELECT COUNT(*) AS count FROM ticket_tags
      WHERE tenant_id = ${tenantId}::uuid AND tag_id = ${tagId}::uuid
    `;
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRecord(row: {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  colour: string | null;
  is_active: boolean;
  usage_count: number;
  created_at: Date;
  updated_at: Date;
}): TagRecord {
  return {
    id:         row.id,
    tenantId:   row.tenant_id,
    name:       row.name,
    slug:       row.slug,
    colour:     row.colour,
    isActive:   row.is_active,
    usageCount: row.usage_count,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}
