/**
 * CategoriesController — HTTP handlers for tenant category management.
 *
 * Framework-agnostic: accepts a plain CategoriesRequest and returns a
 * CategoriesResponse. NestJS, Fastify or raw http adapters can wrap
 * these methods without changing the logic.
 *
 * Endpoints:
 *   GET    /api/v1/categories               → list/tree
 *   POST   /api/v1/categories               → create
 *   PATCH  /api/v1/categories/:id           → rename / reparent / reorder
 *   DELETE /api/v1/categories/:id           → deactivate
 *
 * RBAC:
 *   - Authenticated agents may call GET.
 *   - Only administrators may call POST / PATCH / DELETE.
 */

import type { Sql } from 'postgres';
import { CategoriesService, CategoriesError } from './categories.service.js';
import type { CategoryRecord } from './categories.repository.js';

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

export interface CategoriesRequest {
  method: string;
  path: string;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  /** Resolved from JWT by the auth guard. */
  tenantId: string;
  /** Resolved roles from JWT. */
  roles: string[];
}

export interface CategoriesResponse {
  status: number;
  body?: unknown;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class CategoriesController {
  constructor(
    private readonly service: CategoriesService,
    private readonly getSql: () => Sql,
  ) {}

  // GET /api/v1/categories
  async list(req: CategoriesRequest): Promise<CategoriesResponse> {
    const sql = this.getSql();
    const includeInactive = req.query['include_inactive'] === 'true';
    const flat = req.query['flat'] === 'true';

    await sql.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);
    const nodes = await this.service.getTree(sql, req.tenantId, includeInactive);

    const body = flat ? nodes.map(serializeNode) : buildTree(nodes);
    return { status: 200, body };
  }

  // POST /api/v1/categories
  async create(req: CategoriesRequest): Promise<CategoriesResponse> {
    if (!isAdmin(req.roles)) {
      return errorResponse(403, 'FORBIDDEN', 'Only administrators may create categories.');
    }

    const body = req.body as Record<string, unknown>;
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (!name) return errorResponse(400, 'INVALID_NAME', 'name is required.');

    const parentId = typeof body['parent_id'] === 'string' ? body['parent_id'] : null;
    const sortOrder = typeof body['sort_order'] === 'number' ? body['sort_order'] : undefined;

    const sql = this.getSql();
    await sql.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);

    try {
      const node = await this.service.create(sql, req.tenantId, { name, parentId, sortOrder });
      return { status: 201, body: serializeNode(node) };
    } catch (err) {
      return handleServiceError(err);
    }
  }

  // PATCH /api/v1/categories/:id
  async update(req: CategoriesRequest): Promise<CategoriesResponse> {
    if (!isAdmin(req.roles)) {
      return errorResponse(403, 'FORBIDDEN', 'Only administrators may update categories.');
    }

    const id = req.params['id'];
    if (!id) return errorResponse(400, 'INVALID_ID', 'Category id is required.');

    const body = req.body as Record<string, unknown>;
    const sql = this.getSql();
    await sql.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);

    try {
      let node: CategoryRecord;

      if ('parent_id' in body && !('name' in body) && !('sort_order' in body) && !('is_active' in body)) {
        // Pure reparent operation
        const newParentId = body['parent_id'] === null ? null : String(body['parent_id']);
        const subtree = await this.service.reparent(sql, req.tenantId, id, newParentId);
        node = subtree.find((n) => n.id === id) ?? subtree[0]!;
      } else {
        // Field-by-field update
        if ('name' in body) {
          node = await this.service.rename(sql, req.tenantId, id, String(body['name']).trim());
        } else if ('parent_id' in body) {
          const newParentId = body['parent_id'] === null ? null : String(body['parent_id']);
          const subtree = await this.service.reparent(sql, req.tenantId, id, newParentId);
          node = subtree.find((n) => n.id === id) ?? subtree[0]!;
        } else if ('sort_order' in body) {
          node = await this.service.reorder(sql, req.tenantId, id, Number(body['sort_order']));
        } else if ('is_active' in body) {
          if (body['is_active'] === false) {
            node = await this.service.deactivate(sql, req.tenantId, id);
          } else {
            // Reactivation is a plain update
            const updated = await this.service.getTree(sql, req.tenantId, true);
            const existing = updated.find((n) => n.id === id);
            if (!existing) return errorResponse(404, 'CATEGORY_NOT_FOUND', 'Category not found.');
            node = existing;
          }
        } else {
          return errorResponse(400, 'NO_FIELDS', 'No updatable fields provided.');
        }
      }

      return { status: 200, body: serializeNode(node) };
    } catch (err) {
      return handleServiceError(err);
    }
  }

  // DELETE /api/v1/categories/:id — deactivate (never hard-delete)
  async deactivate(req: CategoriesRequest): Promise<CategoriesResponse> {
    if (!isAdmin(req.roles)) {
      return errorResponse(403, 'FORBIDDEN', 'Only administrators may deactivate categories.');
    }

    const id = req.params['id'];
    if (!id) return errorResponse(400, 'INVALID_ID', 'Category id is required.');

    const sql = this.getSql();
    await sql.unsafe(`SET LOCAL app.current_tenant = '${req.tenantId}'`);

    try {
      const node = await this.service.deactivate(sql, req.tenantId, id);
      return { status: 200, body: serializeNode(node) };
    } catch (err) {
      return handleServiceError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAdmin(roles: string[]): boolean {
  return roles.includes('admin') || roles.includes('administrator');
}

function serializeNode(node: CategoryRecord): Record<string, unknown> {
  return {
    id:          node.id,
    parent_id:   node.parentId,
    name:        node.name,
    slug:        node.slug,
    path:        node.path,
    depth:       node.depth,
    sort_order:  node.sortOrder,
    is_active:   node.isActive,
    ticket_count: node.ticketCount ?? 0,
  };
}

function buildTree(
  flat: CategoryRecord[],
): Array<Record<string, unknown>> {
  type TreeNode = Record<string, unknown> & { children: TreeNode[] };
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const node of flat) {
    map.set(node.id, { ...serializeNode(node), children: [] });
  }

  for (const node of flat) {
    const treeNode = map.get(node.id)!;
    if (node.parentId && map.has(node.parentId)) {
      (map.get(node.parentId)!.children as TreeNode[]).push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  return roots;
}

function handleServiceError(err: unknown): CategoriesResponse {
  if (err instanceof CategoriesError) {
    switch (err.code) {
      case 'CATEGORY_NOT_FOUND':
        return errorResponse(404, err.code, err.message);
      case 'CATEGORY_DUPLICATE':
        return errorResponse(409, err.code, err.message, err.meta);
      case 'CATEGORY_CYCLE':
      case 'CATEGORY_DEPTH_LIMIT':
        return errorResponse(422, err.code, err.message, err.meta);
    }
  }
  throw err;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): CategoriesResponse {
  return {
    status,
    body: { error: code, message, ...meta },
  };
}
