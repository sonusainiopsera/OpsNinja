/**
 * AssignmentGroupsController — HTTP handlers for assignment group management.
 *
 * Endpoints:
 *   GET  /api/v1/assignment-groups             → list groups
 *   POST /api/v1/assignment-groups             → create group
 *   PATCH  /api/v1/assignment-groups/:id       → update group
 *   DELETE /api/v1/assignment-groups/:id       → deactivate group
 *   GET    /api/v1/assignment-groups/:id/members → list members
 *   PUT    /api/v1/assignment-groups/:id/members → replace member list
 *
 * RBAC: only managers/admins may mutate; all agents may read.
 */

import type { Sql } from 'postgres';
import { AssignmentGroupsService, GroupsError } from './assignment-groups.service.js';

export interface GroupsRequest {
  method: string;
  path: string;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  tenantId: string;
  userId: string;
  permissions: string[];
}

export interface GroupsResponse {
  status: number;
  body?: unknown;
}

export class AssignmentGroupsController {
  constructor(
    private readonly service: AssignmentGroupsService,
    private readonly getSql: () => Sql,
  ) {}

  async listGroups(req: GroupsRequest): Promise<GroupsResponse> {
    const sql = this.getSql();
    const includeInactive = req.query['include_inactive'] === 'true';
    await sql.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
    const groups = await this.service.listGroups(sql, req.tenantId, includeInactive);
    return { status: 200, body: groups.map(serializeGroup) };
  }

  async createGroup(req: GroupsRequest): Promise<GroupsResponse> {
    if (!canManageGroups(req.permissions)) {
      return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions to create assignment groups.');
    }

    const body = req.body as Record<string, unknown>;
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (!name) return errorResponse(400, 'INVALID_NAME', 'name is required.');
    const description = typeof body['description'] === 'string' ? body['description'] : null;

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        const group = await this.service.createGroup(tx, req.tenantId, { name, description }, {
          actorId: req.userId,
        });
        return { status: 201, body: serializeGroup(group) };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }

  async updateGroup(req: GroupsRequest): Promise<GroupsResponse> {
    if (!canManageGroups(req.permissions)) {
      return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions to update assignment groups.');
    }

    const id = req.params['id'];
    if (!id) return errorResponse(400, 'MISSING_ID', 'Group id is required.');

    const body = req.body as Record<string, unknown>;
    const input: { name?: string; description?: string | null; isActive?: boolean } = {};
    if (typeof body['name'] === 'string') input.name = body['name'].trim();
    if ('description' in body) input.description = typeof body['description'] === 'string' ? body['description'] : null;
    if (typeof body['is_active'] === 'boolean') input.isActive = body['is_active'];

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        const group = await this.service.updateGroup(tx, req.tenantId, id, input, { actorId: req.userId });
        return { status: 200, body: serializeGroup(group) };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }

  async deactivateGroup(req: GroupsRequest): Promise<GroupsResponse> {
    if (!canManageGroups(req.permissions)) {
      return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions to deactivate assignment groups.');
    }

    const id = req.params['id'];
    if (!id) return errorResponse(400, 'MISSING_ID', 'Group id is required.');

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        const group = await this.service.deactivateGroup(tx, req.tenantId, id, { actorId: req.userId });
        return { status: 200, body: serializeGroup(group) };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }

  async listMembers(req: GroupsRequest): Promise<GroupsResponse> {
    const id = req.params['id'];
    if (!id) return errorResponse(400, 'MISSING_ID', 'Group id is required.');

    const sql = this.getSql();
    await sql.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
    try {
      const members = await this.service.getMembers(sql, req.tenantId, id);
      return { status: 200, body: { user_ids: members.map((m) => m.userId) } };
    } catch (err) {
      return handleServiceError(err);
    }
  }

  async setMembers(req: GroupsRequest): Promise<GroupsResponse> {
    if (!canManageGroups(req.permissions)) {
      return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions to manage group membership.');
    }

    const id = req.params['id'];
    if (!id) return errorResponse(400, 'MISSING_ID', 'Group id is required.');

    const body = req.body as Record<string, unknown>;
    const userIds = Array.isArray(body['user_ids']) ? (body['user_ids'] as string[]) : [];

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        await this.service.setMembers(tx, req.tenantId, id, userIds, { actorId: req.userId });
        const members = await this.service.getMembers(tx, req.tenantId, id);
        return { status: 200, body: { user_ids: members.map((m) => m.userId) } };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canManageGroups(permissions: string[]): boolean {
  return permissions.includes('ticket:reassign');
}

function serializeGroup(group: {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  memberCount?: number;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id:           group.id,
    name:         group.name,
    description:  group.description,
    is_active:    group.isActive,
    member_count: group.memberCount ?? 0,
    created_at:   group.createdAt,
    updated_at:   group.updatedAt,
  };
}

function handleServiceError(err: unknown): GroupsResponse {
  if (err instanceof GroupsError) {
    switch (err.code) {
      case 'GROUP_NOT_FOUND': return errorResponse(404, err.code, err.message);
      case 'GROUP_DUPLICATE': return errorResponse(409, err.code, err.message, err.meta);
    }
  }
  throw err;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): GroupsResponse {
  return { status, body: { error: code, message, ...meta } };
}
