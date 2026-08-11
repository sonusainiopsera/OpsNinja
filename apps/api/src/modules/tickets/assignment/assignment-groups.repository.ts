/**
 * AssignmentGroupsRepository — database operations for assignment_groups and members.
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssignmentGroupRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  memberCount?: number;
}

export interface AssignmentGroupMemberRecord {
  tenantId: string;
  groupId: string;
  userId: string;
  addedAt: Date;
}

export interface CreateGroupParams {
  tenantId: string;
  name: string;
  description?: string | null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AssignmentGroupsRepository {
  async findAll(sql: Sql, tenantId: string, includeInactive = false): Promise<AssignmentGroupRecord[]> {
    type Row = {
      id: string; tenant_id: string; name: string; description: string | null;
      is_active: boolean; created_at: Date; updated_at: Date; member_count: string;
    };
    const rows = await sql<Row[]>`
      SELECT g.id, g.tenant_id, g.name, g.description, g.is_active,
             g.created_at, g.updated_at,
             COUNT(m.user_id) AS member_count
      FROM assignment_groups g
      LEFT JOIN assignment_group_members m
        ON m.tenant_id = g.tenant_id AND m.group_id = g.id
      WHERE g.tenant_id = ${tenantId}::uuid
        ${includeInactive ? sql`` : sql`AND g.is_active = true`}
      GROUP BY g.id, g.tenant_id, g.name, g.description, g.is_active, g.created_at, g.updated_at
      ORDER BY g.name ASC
    `;
    return rows.map(rowToRecord);
  }

  async findById(sql: Sql, tenantId: string, id: string): Promise<AssignmentGroupRecord | null> {
    type Row = {
      id: string; tenant_id: string; name: string; description: string | null;
      is_active: boolean; created_at: Date; updated_at: Date; member_count: string;
    };
    const rows = await sql<Row[]>`
      SELECT g.id, g.tenant_id, g.name, g.description, g.is_active,
             g.created_at, g.updated_at,
             COUNT(m.user_id) AS member_count
      FROM assignment_groups g
      LEFT JOIN assignment_group_members m
        ON m.tenant_id = g.tenant_id AND m.group_id = g.id
      WHERE g.tenant_id = ${tenantId}::uuid AND g.id = ${id}::uuid
      GROUP BY g.id, g.tenant_id, g.name, g.description, g.is_active, g.created_at, g.updated_at
    `;
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async findByName(sql: Sql, tenantId: string, name: string): Promise<AssignmentGroupRecord | null> {
    type Row = {
      id: string; tenant_id: string; name: string; description: string | null;
      is_active: boolean; created_at: Date; updated_at: Date; member_count: string;
    };
    const rows = await sql<Row[]>`
      SELECT g.id, g.tenant_id, g.name, g.description, g.is_active,
             g.created_at, g.updated_at,
             COUNT(m.user_id) AS member_count
      FROM assignment_groups g
      LEFT JOIN assignment_group_members m
        ON m.tenant_id = g.tenant_id AND m.group_id = g.id
      WHERE g.tenant_id = ${tenantId}::uuid AND lower(g.name) = lower(${name})
      GROUP BY g.id, g.tenant_id, g.name, g.description, g.is_active, g.created_at, g.updated_at
    `;
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async create(sql: Sql, params: CreateGroupParams): Promise<AssignmentGroupRecord> {
    type Row = {
      id: string; tenant_id: string; name: string; description: string | null;
      is_active: boolean; created_at: Date; updated_at: Date;
    };
    const rows = await sql<Row[]>`
      INSERT INTO assignment_groups (tenant_id, name, description)
      VALUES (${params.tenantId}::uuid, ${params.name}, ${params.description ?? null})
      RETURNING id, tenant_id, name, description, is_active, created_at, updated_at
    `;
    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows.');
    return { ...rowToRecord({ ...row, member_count: '0' }) };
  }

  async update(
    sql: Sql,
    tenantId: string,
    id: string,
    params: { name?: string; description?: string | null; isActive?: boolean },
  ): Promise<AssignmentGroupRecord | null> {
    const setClauses: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    let idx = 1;

    if (params.name !== undefined)        { setClauses.push(`name = $${idx++}`);        values.push(params.name); }
    if (params.description !== undefined) { setClauses.push(`description = $${idx++}`); values.push(params.description); }
    if (params.isActive !== undefined)    { setClauses.push(`is_active = $${idx++}`);   values.push(params.isActive); }

    if (values.length === 0) return this.findById(sql, tenantId, id);

    values.push(tenantId, id);
    const tenantIdx = idx++;
    const idIdx = idx;

    type Row = {
      id: string; tenant_id: string; name: string; description: string | null;
      is_active: boolean; created_at: Date; updated_at: Date;
    };
    const rows = await sql.unsafe<Row[]>(
      `UPDATE assignment_groups SET ${setClauses.join(', ')}
       WHERE tenant_id = $${tenantIdx}::uuid AND id = $${idIdx}::uuid
       RETURNING id, tenant_id, name, description, is_active, created_at, updated_at`,
      values,
    );
    const row = rows[0];
    return row ? rowToRecord({ ...row, member_count: '0' }) : null;
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  async getMembers(sql: Sql, tenantId: string, groupId: string): Promise<AssignmentGroupMemberRecord[]> {
    type Row = { tenant_id: string; group_id: string; user_id: string; added_at: Date };
    const rows = await sql<Row[]>`
      SELECT tenant_id, group_id, user_id, added_at
      FROM assignment_group_members
      WHERE tenant_id = ${tenantId}::uuid AND group_id = ${groupId}::uuid
      ORDER BY added_at ASC
    `;
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      groupId:  r.group_id,
      userId:   r.user_id,
      addedAt:  r.added_at,
    }));
  }

  async getUserGroups(sql: Sql, tenantId: string, userId: string): Promise<string[]> {
    const rows = await sql<[{ group_id: string }]>`
      SELECT group_id FROM assignment_group_members
      WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid
    `;
    return rows.map((r) => r.group_id);
  }

  /**
   * Replaces the membership set for a group with the supplied user IDs.
   * Uses DELETE + INSERT (not UPSERT) so that added_at reflects current time.
   */
  async setMembers(sql: Sql, tenantId: string, groupId: string, userIds: string[]): Promise<void> {
    await sql`
      DELETE FROM assignment_group_members
      WHERE tenant_id = ${tenantId}::uuid AND group_id = ${groupId}::uuid
    `;

    if (userIds.length === 0) return;

    const values = userIds.map((uid) => `('${tenantId}'::uuid, '${groupId}'::uuid, '${uid}'::uuid)`).join(', ');
    await sql.unsafe(
      `INSERT INTO assignment_group_members (tenant_id, group_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRecord(row: {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  member_count: string;
}): AssignmentGroupRecord {
  return {
    id:          row.id,
    tenantId:    row.tenant_id,
    name:        row.name,
    description: row.description,
    isActive:    row.is_active,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
    memberCount: parseInt(row.member_count, 10),
  };
}
