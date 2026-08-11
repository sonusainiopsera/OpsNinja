/**
 * TagsController — HTTP handlers for tag management and ticket tagging.
 *
 * Framework-agnostic: accepts plain request/response shapes.
 *
 * Endpoints:
 *   GET    /api/v1/tags                      → list tags
 *   POST   /api/v1/tags                      → create tag
 *   PATCH  /api/v1/tags/:id                  → rename / recolour / toggle
 *   DELETE /api/v1/tags/:id                  → deactivate tag
 *   POST   /api/v1/tags/:id/merge            → merge into target
 *   POST   /api/v1/tickets/:id/tags          → attach tags to ticket
 *   DELETE /api/v1/tickets/:id/tags/:tagId   → detach tag from ticket
 *
 * RBAC:
 *   - All authenticated users may read tags.
 *   - Only managers/leads/admins may mutate tags (create/update/deactivate/merge).
 *   - Agents and above may attach/detach tags on tickets.
 */

import type { Sql } from 'postgres';
import { TagsService, TagsError } from './tags.service.js';

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

export interface TagsRequest {
  method: string;
  path: string;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  tenantId: string;
  userId: string;
  permissions: string[];
}

export interface TagsResponse {
  status: number;
  body?: unknown;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class TagsController {
  constructor(
    private readonly service: TagsService,
    private readonly getSql: () => Sql,
  ) {}

  // GET /api/v1/tags
  async listTags(req: TagsRequest): Promise<TagsResponse> {
    const sql = this.getSql();
    const includeInactive = req.query['include_inactive'] === 'true';
    await sql.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
    const tags = await this.service.listTags(sql, req.tenantId, includeInactive);
    return { status: 200, body: tags.map(serializeTag) };
  }

  // POST /api/v1/tags
  async createTag(req: TagsRequest): Promise<TagsResponse> {
    if (!canManageTags(req.permissions)) {
      return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions to create tags.');
    }

    const body = req.body as Record<string, unknown>;
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (!name) return errorResponse(400, 'INVALID_NAME', 'name is required.');
    const colour = typeof body['colour'] === 'string' ? body['colour'] : null;

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        const tag = await this.service.createTag(tx, req.tenantId, { name, colour }, {
          returnExistingOnConflict: false,
          actorId: req.userId,
        });
        return { status: 201, body: serializeTag(tag) };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }

  // PATCH /api/v1/tags/:id
  async updateTag(req: TagsRequest): Promise<TagsResponse> {
    if (!canManageTags(req.permissions)) {
      return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions to update tags.');
    }

    const id = req.params['id'];
    if (!id) return errorResponse(400, 'MISSING_ID', 'Tag id is required.');

    const body = req.body as Record<string, unknown>;
    const input: { name?: string; colour?: string | null; isActive?: boolean } = {};
    if (typeof body['name'] === 'string') input.name = body['name'].trim();
    if ('colour' in body) input.colour = typeof body['colour'] === 'string' ? body['colour'] : null;
    if (typeof body['is_active'] === 'boolean') input.isActive = body['is_active'];

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        const tag = await this.service.updateTag(tx, req.tenantId, id, input, { actorId: req.userId });
        return { status: 200, body: serializeTag(tag) };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }

  // DELETE /api/v1/tags/:id
  async deactivateTag(req: TagsRequest): Promise<TagsResponse> {
    if (!canManageTags(req.permissions)) {
      return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions to deactivate tags.');
    }

    const id = req.params['id'];
    if (!id) return errorResponse(400, 'MISSING_ID', 'Tag id is required.');

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        const tag = await this.service.deactivateTag(tx, req.tenantId, id, { actorId: req.userId });
        return { status: 200, body: serializeTag(tag) };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }

  // POST /api/v1/tags/:id/merge
  async mergeTags(req: TagsRequest): Promise<TagsResponse> {
    if (!canManageTags(req.permissions)) {
      return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions to merge tags.');
    }

    const sourceId = req.params['id'];
    if (!sourceId) return errorResponse(400, 'MISSING_ID', 'Source tag id is required.');

    const body = req.body as Record<string, unknown>;
    const targetId = typeof body['target_tag_id'] === 'string' ? body['target_tag_id'] : null;
    if (!targetId) return errorResponse(400, 'MISSING_TARGET', 'target_tag_id is required.');

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        const result = await this.service.mergeTags(tx, req.tenantId, sourceId, targetId, {
          actorId: req.userId,
        });
        return { status: 200, body: result };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }

  // POST /api/v1/tickets/:id/tags  (body: { tag_ids: string[] })
  async attachTags(req: TagsRequest): Promise<TagsResponse> {
    const ticketId = req.params['id'];
    if (!ticketId) return errorResponse(400, 'MISSING_ID', 'Ticket id is required.');

    const body = req.body as Record<string, unknown>;
    const tagIds = Array.isArray(body['tag_ids']) ? (body['tag_ids'] as string[]) : [];

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        for (const tagId of tagIds) {
          await this.service.attachTag(tx, req.tenantId, ticketId, tagId);
        }
        const tags = await this.service.getTicketTags(tx, req.tenantId, ticketId);
        return { status: 200, body: { tag_ids: tags.map((t) => t.id) } };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }

  // DELETE /api/v1/tickets/:id/tags/:tagId
  async detachTag(req: TagsRequest): Promise<TagsResponse> {
    const ticketId = req.params['id'];
    const tagId = req.params['tagId'];
    if (!ticketId || !tagId) return errorResponse(400, 'MISSING_ID', 'Ticket id and tag id are required.');

    const sql = this.getSql();
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
      try {
        await this.service.detachTag(tx, req.tenantId, ticketId, tagId);
        return { status: 200, body: {} };
      } catch (err) {
        return handleServiceError(err);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canManageTags(permissions: string[]): boolean {
  return permissions.includes('ticket:reassign') || permissions.includes('category:manage');
}

function serializeTag(tag: {
  id: string;
  name: string;
  slug: string;
  colour: string | null;
  isActive: boolean;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id:          tag.id,
    name:        tag.name,
    slug:        tag.slug,
    colour:      tag.colour,
    is_active:   tag.isActive,
    usage_count: tag.usageCount,
    created_at:  tag.createdAt,
    updated_at:  tag.updatedAt,
  };
}

function handleServiceError(err: unknown): TagsResponse {
  if (err instanceof TagsError) {
    switch (err.code) {
      case 'TAG_NOT_FOUND':    return errorResponse(404, err.code, err.message);
      case 'TAG_DUPLICATE':    return errorResponse(409, err.code, err.message, err.meta);
      case 'TAG_CAP_EXCEEDED': return errorResponse(422, err.code, err.message, err.meta);
      case 'TAG_SELF_MERGE':   return errorResponse(422, err.code, err.message, err.meta);
    }
  }
  throw err;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): TagsResponse {
  return { status, body: { error: code, message, ...meta } };
}
