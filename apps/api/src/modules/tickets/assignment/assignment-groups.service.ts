/**
 * AssignmentGroupsService — business logic for assignment group management.
 *
 * Error codes:
 *   GROUP_NOT_FOUND  → 404
 *   GROUP_DUPLICATE  → 409 (name conflict)
 */

import type { Sql } from 'postgres';
import {
  AssignmentGroupsRepository,
  type AssignmentGroupRecord,
  type AssignmentGroupMemberRecord,
} from './assignment-groups.repository.js';
import type { AuditWriter } from '../../audit/audit-writer.service.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type GroupsErrorCode = 'GROUP_NOT_FOUND' | 'GROUP_DUPLICATE';

export class GroupsError extends Error {
  constructor(
    public readonly code: GroupsErrorCode,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GroupsError';
  }
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateGroupInput {
  name: string;
  description?: string | null;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AssignmentGroupsService {
  constructor(
    private readonly repo: AssignmentGroupsRepository,
    private readonly auditWriter: AuditWriter | null,
  ) {}

  async listGroups(
    sql: Sql,
    tenantId: string,
    includeInactive = false,
  ): Promise<AssignmentGroupRecord[]> {
    return this.repo.findAll(sql, tenantId, includeInactive);
  }

  async getGroup(sql: Sql, tenantId: string, id: string): Promise<AssignmentGroupRecord> {
    const group = await this.repo.findById(sql, tenantId, id);
    if (!group) throw new GroupsError('GROUP_NOT_FOUND', `Group ${id} not found.`);
    return group;
  }

  async createGroup(
    sql: Sql,
    tenantId: string,
    input: CreateGroupInput,
    opts: { actorId?: string } = {},
  ): Promise<AssignmentGroupRecord> {
    const existing = await this.repo.findByName(sql, tenantId, input.name);
    if (existing) {
      throw new GroupsError('GROUP_DUPLICATE', `A group named "${input.name}" already exists.`, {
        existingId: existing.id,
      });
    }

    const group = await this.repo.create(sql, {
      tenantId,
      name: input.name,
      description: input.description ?? null,
    });

    if (this.auditWriter && opts.actorId) {
      await this.auditWriter.append(sql, {
        tenantId,
        actorType: 'user',
        actorId: opts.actorId,
        action: 'assignment_group.created',
        resourceType: 'assignment_group',
        resourceId: group.id,
        afterState: { name: group.name },
      });
    }

    return group;
  }

  async updateGroup(
    sql: Sql,
    tenantId: string,
    id: string,
    input: UpdateGroupInput,
    opts: { actorId?: string } = {},
  ): Promise<AssignmentGroupRecord> {
    const existing = await this.repo.findById(sql, tenantId, id);
    if (!existing) throw new GroupsError('GROUP_NOT_FOUND', `Group ${id} not found.`);

    if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const conflict = await this.repo.findByName(sql, tenantId, input.name);
      if (conflict) {
        throw new GroupsError('GROUP_DUPLICATE', `A group named "${input.name}" already exists.`, {
          existingId: conflict.id,
        });
      }
    }

    const updated = await this.repo.update(sql, tenantId, id, {
      name:        input.name,
      description: input.description,
      isActive:    input.isActive,
    });
    if (!updated) throw new GroupsError('GROUP_NOT_FOUND', 'Group not found after update.');

    if (this.auditWriter && opts.actorId) {
      await this.auditWriter.append(sql, {
        tenantId,
        actorType: 'user',
        actorId: opts.actorId,
        action: 'assignment_group.updated',
        resourceType: 'assignment_group',
        resourceId: id,
        beforeState: { name: existing.name, isActive: existing.isActive },
        afterState:  { name: updated.name,  isActive: updated.isActive  },
      });
    }

    return updated;
  }

  async deactivateGroup(
    sql: Sql,
    tenantId: string,
    id: string,
    opts: { actorId?: string } = {},
  ): Promise<AssignmentGroupRecord> {
    return this.updateGroup(sql, tenantId, id, { isActive: false }, opts);
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  async getMembers(
    sql: Sql,
    tenantId: string,
    groupId: string,
  ): Promise<AssignmentGroupMemberRecord[]> {
    const group = await this.repo.findById(sql, tenantId, groupId);
    if (!group) throw new GroupsError('GROUP_NOT_FOUND', `Group ${groupId} not found.`);
    return this.repo.getMembers(sql, tenantId, groupId);
  }

  /**
   * Replaces the full member list. Validates that all userIds are same-tenant
   * (caller must supply the validated user IDs from the identity module).
   * Membership changes are audited.
   */
  async setMembers(
    sql: Sql,
    tenantId: string,
    groupId: string,
    userIds: string[],
    opts: { actorId?: string } = {},
  ): Promise<void> {
    const group = await this.repo.findById(sql, tenantId, groupId);
    if (!group) throw new GroupsError('GROUP_NOT_FOUND', `Group ${groupId} not found.`);

    const previousMembers = await this.repo.getMembers(sql, tenantId, groupId);
    await this.repo.setMembers(sql, tenantId, groupId, userIds);

    if (this.auditWriter && opts.actorId) {
      await this.auditWriter.append(sql, {
        tenantId,
        actorType: 'user',
        actorId: opts.actorId,
        action: 'assignment_group.members_updated',
        resourceType: 'assignment_group',
        resourceId: groupId,
        beforeState: { userIds: previousMembers.map((m) => m.userId) },
        afterState:  { userIds },
      });
    }
  }
}
