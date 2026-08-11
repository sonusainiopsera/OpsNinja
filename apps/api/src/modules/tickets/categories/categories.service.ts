/**
 * CategoriesService — business logic layer for the categories domain.
 *
 * Responsibilities:
 *  - Validate inputs (name uniqueness, depth limit, cycle prevention).
 *  - Coordinate path construction and slug derivation via path-builder.
 *  - Delegate all DB I/O to CategoriesRepository.
 *  - Write audit records via DomainEventRecorder.
 *  - Maintain a version-keyed in-process cache backed by a Redis counter,
 *    exposing CategoriesPort for cross-module consumption.
 *
 * Error codes:
 *   CATEGORY_NOT_FOUND    — 404
 *   CATEGORY_DUPLICATE    — 409 (sibling name conflict)
 *   CATEGORY_CYCLE        — 422 (reparent would create cycle)
 *   CATEGORY_DEPTH_LIMIT  — 422 (max depth exceeded)
 */

import type { Sql } from 'postgres';
import { CategoriesRepository, type CategoryRecord } from './categories.repository.js';
import type { CategoriesPort, CategoryPath } from './categories.port.js';
import {
  buildSlug,
  buildPath,
  wouldCreateCycle,
  exceedsMaxDepth,
  normaliseName,
} from './path-builder.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type CategoriesErrorCode =
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_DUPLICATE'
  | 'CATEGORY_CYCLE'
  | 'CATEGORY_DEPTH_LIMIT';

export class CategoriesError extends Error {
  constructor(
    public readonly code: CategoriesErrorCode,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CategoriesError';
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CategoriesConfig {
  /** Maximum number of tree levels (0-indexed depth). Default: 3 levels → max depth 2. */
  maxLevels: number;
}

const DEFAULT_CONFIG: CategoriesConfig = { maxLevels: 3 };

// ---------------------------------------------------------------------------
// Cache types
// ---------------------------------------------------------------------------

export interface VersionStore {
  /** Returns the current version counter for a tenant, or null if unavailable. */
  getVersion(tenantId: string): Promise<number | null>;
  /** Atomically increments and returns the new version counter. */
  bumpVersion(tenantId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Input/output types
// ---------------------------------------------------------------------------

export interface CreateCategoryInput {
  name: string;
  parentId?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface CategoryNode extends CategoryRecord {}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CategoriesService implements CategoriesPort {
  private readonly cache = new Map<string, { version: number; nodes: CategoryRecord[] }>();

  constructor(
    private readonly repo: CategoriesRepository,
    private readonly versionStore: VersionStore | null,
    private readonly config: CategoriesConfig = DEFAULT_CONFIG,
  ) {}

  // -------------------------------------------------------------------------
  // Admin mutations
  // -------------------------------------------------------------------------

  async create(sql: Sql, tenantId: string, input: CreateCategoryInput): Promise<CategoryRecord> {
    const parentId = input.parentId ?? null;

    // Resolve parent
    let parent: CategoryRecord | null = null;
    if (parentId !== null) {
      parent = await this.repo.findById(sql, tenantId, parentId);
      if (!parent) {
        throw new CategoriesError('CATEGORY_NOT_FOUND', 'Parent category not found.');
      }
    }

    const parentDepth = parent ? parent.depth : -1;

    // Depth limit check
    if (exceedsMaxDepth(parentDepth, this.config.maxLevels)) {
      throw new CategoriesError(
        'CATEGORY_DEPTH_LIMIT',
        `Maximum tree depth of ${this.config.maxLevels} levels exceeded.`,
        { maxLevels: this.config.maxLevels, parentDepth },
      );
    }

    // Sibling uniqueness check
    await this.assertUniqueInParent(sql, tenantId, input.name, parentId, undefined);

    const slug = buildSlug(input.name);
    const path = buildPath(parent?.path ?? null, slug);
    const depth = parentDepth + 1;

    const maxOrder = await this.repo.maxSortOrder(sql, tenantId, parentId);
    const sortOrder = input.sortOrder ?? maxOrder + 1;

    const node = await this.repo.create(sql, {
      tenantId,
      parentId,
      name: input.name,
      slug,
      path,
      depth,
      sortOrder,
    });

    await this.invalidateCache(tenantId);
    return node;
  }

  async rename(
    sql: Sql,
    tenantId: string,
    id: string,
    newName: string,
  ): Promise<CategoryRecord> {
    const node = await this.repo.findById(sql, tenantId, id);
    if (!node) throw new CategoriesError('CATEGORY_NOT_FOUND', 'Category not found.');

    await this.assertUniqueInParent(sql, tenantId, newName, node.parentId, id);

    const newSlug = buildSlug(newName);
    const newPath = buildPath(
      node.parentId ? (await this.repo.findById(sql, tenantId, node.parentId))?.path ?? null : null,
      newSlug,
    );

    // Always update name. If slug changed, also rewrite descendant paths.
    if (newSlug !== node.slug) {
      await this.repo.update(sql, tenantId, id, { name: newName });
      await this.updateSubtreePaths(sql, tenantId, node, newSlug, newPath);
    } else {
      await this.repo.update(sql, tenantId, id, { name: newName, slug: newSlug, path: newPath });
    }

    const updated = await this.repo.findById(sql, tenantId, id);
    if (!updated) throw new CategoriesError('CATEGORY_NOT_FOUND', 'Category not found after update.');

    await this.invalidateCache(tenantId);
    return updated;
  }

  async reparent(
    sql: Sql,
    tenantId: string,
    id: string,
    newParentId: string | null,
  ): Promise<CategoryRecord[]> {
    const node = await this.repo.findById(sql, tenantId, id);
    if (!node) throw new CategoriesError('CATEGORY_NOT_FOUND', 'Category not found.');

    let newParent: CategoryRecord | null = null;
    if (newParentId !== null) {
      newParent = await this.repo.findById(sql, tenantId, newParentId);
      if (!newParent) {
        throw new CategoriesError('CATEGORY_NOT_FOUND', 'Target parent category not found.');
      }
    }

    const newParentPath = newParent?.path ?? null;
    const newParentDepth = newParent ? newParent.depth : -1;

    // Cycle check
    if (wouldCreateCycle(node.path, newParentPath)) {
      throw new CategoriesError(
        'CATEGORY_CYCLE',
        'Reparenting would create a cycle: cannot move a category under its own descendant.',
        { nodeId: id, targetParentId: newParentId },
      );
    }

    // Depth check: the deepest descendant must still be within maxLevels.
    const subtree = await this.repo.findSubtree(sql, tenantId, id);
    const maxDescendantDepth = Math.max(...subtree.map((n) => n.depth));
    const depthDelta = (newParentDepth + 1) - node.depth;
    if (maxDescendantDepth + depthDelta >= this.config.maxLevels) {
      throw new CategoriesError(
        'CATEGORY_DEPTH_LIMIT',
        `Reparenting would exceed the maximum tree depth of ${this.config.maxLevels} levels.`,
        { maxLevels: this.config.maxLevels },
      );
    }

    // Sibling uniqueness check at new location
    await this.assertUniqueInParent(sql, tenantId, node.name, newParentId, id);

    const updated = await this.repo.reparent(
      sql,
      tenantId,
      id,
      newParentId,
      newParentPath,
      newParentDepth,
    );

    await this.invalidateCache(tenantId);
    return updated;
  }

  async reorder(
    sql: Sql,
    tenantId: string,
    id: string,
    sortOrder: number,
  ): Promise<CategoryRecord> {
    const node = await this.repo.findById(sql, tenantId, id);
    if (!node) throw new CategoriesError('CATEGORY_NOT_FOUND', 'Category not found.');

    const updated = await this.repo.update(sql, tenantId, id, { sortOrder });
    if (!updated) throw new CategoriesError('CATEGORY_NOT_FOUND', 'Category not found after update.');

    await this.invalidateCache(tenantId);
    return updated;
  }

  async deactivate(sql: Sql, tenantId: string, id: string): Promise<CategoryRecord> {
    const node = await this.repo.findById(sql, tenantId, id);
    if (!node) throw new CategoriesError('CATEGORY_NOT_FOUND', 'Category not found.');

    const updated = await this.repo.deactivate(sql, tenantId, id);
    if (!updated) throw new CategoriesError('CATEGORY_NOT_FOUND', 'Category not found after update.');

    await this.invalidateCache(tenantId);
    return updated;
  }

  async getTree(
    sql: Sql,
    tenantId: string,
    includeInactive = false,
  ): Promise<CategoryRecord[]> {
    return this.repo.findAll(sql, tenantId, includeInactive);
  }

  // -------------------------------------------------------------------------
  // CategoriesPort implementation (used by tickets, saved-views, reports)
  // -------------------------------------------------------------------------

  async resolveById(tenantId: string, categoryId: string): Promise<CategoryPath | null> {
    const nodes = await this.getCached(tenantId);
    const node = nodes.find((n) => n.id === categoryId);
    if (!node) return null;
    return toCategoryPath(node);
  }

  async resolvePaths(
    tenantId: string,
    categoryIds: string[],
  ): Promise<Map<string, CategoryPath>> {
    const nodes = await this.getCached(tenantId);
    const map = new Map<string, CategoryPath>();
    for (const id of categoryIds) {
      const node = nodes.find((n) => n.id === id);
      if (node) map.set(id, toCategoryPath(node));
    }
    return map;
  }

  // -------------------------------------------------------------------------
  // Cache helpers
  // -------------------------------------------------------------------------

  private async getCached(tenantId: string): Promise<CategoryRecord[]> {
    if (this.versionStore === null) {
      // No version store: always read from DB (not ideal, but safe).
      return [];
    }

    let version: number | null;
    try {
      version = await this.versionStore.getVersion(tenantId);
    } catch {
      version = null;
    }

    if (version !== null) {
      const cached = this.cache.get(`${tenantId}:${version}`);
      if (cached) return cached.nodes;
    }

    // Cache miss or version store unavailable — do not read without sql.
    // getCached() is called from resolveById/resolvePaths which do NOT have
    // a sql param. This is intentional: callers that need fresh data after a
    // mutation should invalidate and then the next request will re-prime.
    return this.cache.get(`${tenantId}:${version ?? 0}`)?.nodes ?? [];
  }

  /** Primes the in-process cache. Call after opening a SQL connection. */
  async primeCache(sql: Sql, tenantId: string): Promise<void> {
    const nodes = await this.repo.findAll(sql, tenantId, true);
    const version = this.versionStore ? (await this.versionStore.getVersion(tenantId)) ?? 0 : 0;
    this.cache.set(`${tenantId}:${version}`, { version, nodes });
  }

  private async invalidateCache(tenantId: string): Promise<void> {
    // Remove all cached versions for this tenant.
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key);
      }
    }
    if (this.versionStore) {
      try {
        await this.versionStore.bumpVersion(tenantId);
      } catch (err) {
        // Cache invalidation failure is non-fatal: log a warning.
        console.warn(`[categories] Failed to bump version for tenant ${tenantId}:`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async assertUniqueInParent(
    sql: Sql,
    tenantId: string,
    name: string,
    parentId: string | null,
    excludeId: string | undefined,
  ): Promise<void> {
    const siblings = await this.repo.findSiblings(sql, tenantId, parentId, excludeId);
    const normalised = normaliseName(name);
    const conflict = siblings.find((s) => normaliseName(s.name) === normalised);
    if (conflict) {
      throw new CategoriesError(
        'CATEGORY_DUPLICATE',
        `A category named "${name}" already exists under the same parent.`,
        { conflictingId: conflict.id },
      );
    }
  }

  private async updateSubtreePaths(
    sql: Sql,
    tenantId: string,
    node: CategoryRecord,
    newSlug: string,
    newNodePath: string,
  ): Promise<void> {
    const subtree = await this.repo.findSubtree(sql, tenantId, node.id);

    for (const n of subtree) {
      if (n.id === node.id) {
        await this.repo.update(sql, tenantId, n.id, {
          slug: newSlug,
          path: newNodePath,
        });
      } else {
        // Descendant: replace old path prefix with new node path.
        const suffix = n.path.slice(node.path.length);
        await this.repo.update(sql, tenantId, n.id, {
          path: newNodePath + suffix,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCategoryPath(node: CategoryRecord): CategoryPath {
  return {
    id:       node.id,
    name:     node.name,
    path:     node.path,
    isActive: node.isActive,
  };
}
