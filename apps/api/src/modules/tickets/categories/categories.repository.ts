/**
 * CategoriesRepository — all direct database operations for the categories table.
 *
 * Every method accepts a postgres.js `Sql` instance.  The caller is responsible
 * for setting `app.current_tenant` and wrapping mutations in a transaction.
 *
 * Path rewriting uses a recursive CTE so that reparenting a subtree with N
 * descendants is a single round-trip that respects row-level locks.
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CategoryRecord {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Transient: ticket count from a LEFT JOIN — may be absent on basic reads. */
  ticketCount?: number;
}

export interface CreateCategoryParams {
  tenantId: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  sortOrder: number;
}

export interface UpdateCategoryParams {
  name?: string;
  slug?: string;
  path?: string;
  depth?: number;
  sortOrder?: number;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class CategoriesRepository {
  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  async findAll(
    sql: Sql,
    tenantId: string,
    includeInactive = false,
  ): Promise<CategoryRecord[]> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT c.*, COUNT(t.id)::int AS ticket_count
      FROM   categories c
      LEFT JOIN tickets t
             ON t.tenant_id = c.tenant_id AND t.category_id = c.id
      WHERE  c.tenant_id = $1::uuid
        AND  ($2::boolean OR c.is_active = true)
      GROUP BY c.tenant_id, c.id
      ORDER BY c.depth, c.sort_order, lower(c.name)
    `, [tenantId, includeInactive]);
    return rows.map(mapRow);
  }

  async findById(sql: Sql, tenantId: string, id: string): Promise<CategoryRecord | null> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT *
      FROM   categories
      WHERE  tenant_id = $1::uuid AND id = $2::uuid
    `, [tenantId, id]);
    return rows.length > 0 ? mapRow(rows[0]!) : null;
  }

  /** Returns the full subtree rooted at nodeId (inclusive) using a recursive CTE. */
  async findSubtree(sql: Sql, tenantId: string, nodeId: string): Promise<CategoryRecord[]> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      WITH RECURSIVE subtree AS (
        SELECT *
        FROM   categories
        WHERE  tenant_id = $1::uuid AND id = $2::uuid

        UNION ALL

        SELECT c.*
        FROM   categories c
        INNER JOIN subtree s ON c.tenant_id = $1::uuid AND c.parent_id = s.id
      )
      SELECT * FROM subtree
      ORDER BY depth, sort_order, lower(name)
    `, [tenantId, nodeId]);
    return rows.map(mapRow);
  }

  /** Loads sibling nodes sharing the same parent (or all root nodes if parentId is null). */
  async findSiblings(
    sql: Sql,
    tenantId: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<CategoryRecord[]> {
    if (parentId === null) {
      const rows = await sql.unsafe<Record<string, unknown>[]>(`
        SELECT *
        FROM   categories
        WHERE  tenant_id = $1::uuid
          AND  parent_id IS NULL
          AND  ($2::uuid IS NULL OR id != $2::uuid)
      `, [tenantId, excludeId ?? null]);
      return rows.map(mapRow);
    }
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT *
      FROM   categories
      WHERE  tenant_id = $1::uuid
        AND  parent_id = $2::uuid
        AND  ($3::uuid IS NULL OR id != $3::uuid)
    `, [tenantId, parentId, excludeId ?? null]);
    return rows.map(mapRow);
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  async create(sql: Sql, params: CreateCategoryParams): Promise<CategoryRecord> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      INSERT INTO categories
        (tenant_id, id, parent_id, name, slug, path, depth, sort_order, is_active)
      VALUES
        ($1::uuid, gen_random_uuid(), $2::uuid, $3, $4, $5, $6, $7, true)
      RETURNING *
    `, [
      params.tenantId,
      params.parentId,
      params.name,
      params.slug,
      params.path,
      params.depth,
      params.sortOrder,
    ]);
    return mapRow(rows[0]!);
  }

  async update(
    sql: Sql,
    tenantId: string,
    id: string,
    params: UpdateCategoryParams,
  ): Promise<CategoryRecord | null> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [tenantId, id];
    let i = 3;

    if (params.name !== undefined) { sets.push(`name = $${i}::text`); values.push(params.name); i++; }
    if (params.slug !== undefined) { sets.push(`slug = $${i}::text`); values.push(params.slug); i++; }
    if (params.path !== undefined) { sets.push(`path = $${i}::text`); values.push(params.path); i++; }
    if (params.depth !== undefined) { sets.push(`depth = $${i}::int`); values.push(params.depth); i++; }
    if (params.sortOrder !== undefined) { sets.push(`sort_order = $${i}::int`); values.push(params.sortOrder); i++; }
    if (params.isActive !== undefined) { sets.push(`is_active = $${i}::boolean`); values.push(params.isActive); i++; }

    if (sets.length === 1) return this.findById(sql, tenantId, id);

    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      UPDATE categories
      SET    ${sets.join(', ')}
      WHERE  tenant_id = $1::uuid AND id = $2::uuid
      RETURNING *
    `, values);
    return rows.length > 0 ? mapRow(rows[0]!) : null;
  }

  /**
   * Reparents a node and rewrites all descendant paths in a single UPDATE
   * using a recursive CTE. The entire subtree is locked FOR UPDATE so
   * concurrent reparents cannot interleave.
   *
   * Caller must ensure:
   *   - cycle check has been performed
   *   - depth limit has been checked
   *   - this is called inside a transaction
   */
  async reparent(
    sql: Sql,
    tenantId: string,
    nodeId: string,
    newParentId: string | null,
    newParentPath: string | null,
    newParentDepth: number,
  ): Promise<CategoryRecord[]> {
    // Read the moving node under a lock (FOR UPDATE).
    const nodeRows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT * FROM categories
      WHERE  tenant_id = $1::uuid AND id = $2::uuid
      FOR UPDATE
    `, [tenantId, nodeId]);

    if (nodeRows.length === 0) return [];
    const node = mapRow(nodeRows[0]!);

    const newNodePath = newParentPath ? `${newParentPath}/${node.slug}` : node.slug;
    const depthDelta = (newParentDepth + 1) - node.depth;
    const oldPathPrefix = node.path;

    // Lock the full subtree and apply the path/depth rewrite in one statement.
    const updated = await sql.unsafe<Record<string, unknown>[]>(`
      WITH RECURSIVE subtree AS (
        SELECT id FROM categories
        WHERE  tenant_id = $1::uuid AND id = $2::uuid

        UNION ALL

        SELECT c.id
        FROM   categories c
        INNER JOIN subtree s ON c.tenant_id = $1::uuid AND c.parent_id = s.id
      )
      UPDATE categories AS c
      SET
        parent_id  = CASE WHEN c.id = $2::uuid THEN $3::uuid ELSE c.parent_id END,
        path       = $4::text || substring(c.path FROM length($5::text) + 1),
        depth      = c.depth + $6::int,
        updated_at = now()
      FROM subtree
      WHERE  c.tenant_id = $1::uuid AND c.id = subtree.id
      RETURNING c.*
    `, [tenantId, nodeId, newParentId, newNodePath, oldPathPrefix, depthDelta]);

    return updated.map(mapRow);
  }

  /**
   * Soft-deletes a category (sets is_active = false).
   * Does NOT cascade to children; children retain their is_active state.
   */
  async deactivate(sql: Sql, tenantId: string, id: string): Promise<CategoryRecord | null> {
    return this.update(sql, tenantId, id, { isActive: false });
  }

  /**
   * Returns the maximum sort_order among siblings so the caller can append
   * a new node at the end.
   */
  async maxSortOrder(
    sql: Sql,
    tenantId: string,
    parentId: string | null,
  ): Promise<number> {
    let rows: Record<string, unknown>[];
    if (parentId === null) {
      rows = await sql.unsafe<Record<string, unknown>[]>(`
        SELECT COALESCE(MAX(sort_order), -1) AS max_order
        FROM   categories
        WHERE  tenant_id = $1::uuid AND parent_id IS NULL
      `, [tenantId]);
    } else {
      rows = await sql.unsafe<Record<string, unknown>[]>(`
        SELECT COALESCE(MAX(sort_order), -1) AS max_order
        FROM   categories
        WHERE  tenant_id = $1::uuid AND parent_id = $2::uuid
      `, [tenantId, parentId]);
    }
    return Number((rows[0] as Record<string, unknown>)?.['max_order'] ?? -1);
  }
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapRow(row: Record<string, unknown>): CategoryRecord {
  return {
    id:          row['id'] as string,
    tenantId:    row['tenant_id'] as string,
    parentId:    (row['parent_id'] as string | null) ?? null,
    name:        row['name'] as string,
    slug:        row['slug'] as string,
    path:        row['path'] as string,
    depth:       Number(row['depth'] ?? 0),
    sortOrder:   Number(row['sort_order'] ?? 0),
    isActive:    Boolean(row['is_active'] ?? true),
    createdAt:   new Date(row['created_at'] as string),
    updatedAt:   new Date(row['updated_at'] as string),
    ticketCount: row['ticket_count'] !== undefined ? Number(row['ticket_count']) : undefined,
  };
}
