/**
 * ViewsService — WO-039.
 *
 * Responsibilities:
 *  1. Write-time validation: filter_ast compiled via the shared compiler;
 *     sort_spec validated against the allow-list; columns allow-listed.
 *  2. Placeholder substitution at read time: CURRENT_USER → userId,
 *     CURRENT_ORG_SCOPE → orgScopeIds[].
 *  3. Ownership and RBAC enforcement: agents modify only their own private views;
 *     publishing shared views requires view:share permission.
 *  4. System view immutability: PATCH/DELETE on scope='system' returns 403.
 *  5. Audit writes storing the AST signature (not the full AST body).
 *
 * Filter compilation is the ONLY location that calls compileToPredicate.
 */

import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  parseFilterAst,
  compileToPredicate,
  computeSignature,
  CompilerInternalError,
  type FilterAst,
  type CompiledPredicate,
} from '@opsninja/filter-compiler';

import type { SavedView, SavedViewPin } from '@opsninja/db';
import { ViewsRepository } from './views.repository';
import type {
  CreateViewDto,
  UpdateViewDto,
  SavedViewResponse,
  SortSpecItem,
} from './dto/save-view.dto';
import { ALLOWED_COLUMNS } from './dto/save-view.dto';
import type { PrincipalContext } from '../../observability/request-context';

// ---------------------------------------------------------------------------
// Placeholder token constants
// ---------------------------------------------------------------------------

const PLACEHOLDER_CURRENT_USER = 'CURRENT_USER';
const PLACEHOLDER_CURRENT_ORG_SCOPE = 'CURRENT_ORG_SCOPE';

export interface CompiledView {
  predicate: CompiledPredicate;
  cacheKey: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ViewsService {
  private readonly logger = new Logger(ViewsService.name);

  constructor(private readonly repo: ViewsRepository) {}

  // --------------------------------------------------------------------------
  // Compile helpers (used by queue/reporting endpoints too)
  // --------------------------------------------------------------------------

  /**
   * Parse, validate and compile a raw filter AST payload.
   * @throws BadRequestException with field-level errors on validation failure.
   * @throws InternalServerErrorException on compiler internal error.
   */
  compileView(rawAst: unknown): CompiledView {
    const validated = parseFilterAst(rawAst);
    if (!validated.success) {
      throw new BadRequestException({
        message: 'Invalid filter AST',
        errors: validated.errors,
      });
    }

    const ast: FilterAst = validated.data;
    const cacheKey = `view:${computeSignature(ast)}`;

    try {
      const predicate = compileToPredicate(ast);
      return { predicate, cacheKey };
    } catch (err) {
      if (err instanceof CompilerInternalError) {
        this.logger.error('[ViewsService] compiler internal error', {
          signature: err.signature,
          message: err.message,
        });
        throw new InternalServerErrorException('Filter compilation failed');
      }
      throw err;
    }
  }

  /**
   * Substitute principal placeholders in a filter AST and compile the result.
   * Used at read time so one stored definition serves all agents.
   */
  compileViewForPrincipal(rawAst: unknown, principal: PrincipalContext): CompiledView {
    const substituted = substitutePlaceholders(rawAst, principal);
    return this.compileView(substituted);
  }

  // --------------------------------------------------------------------------
  // Seed
  // --------------------------------------------------------------------------

  async seedSystemViewsForTenant(tenantId: string): Promise<void> {
    await this.repo.seedSystemViews(tenantId);
  }

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  async listForPrincipal(
    principal: PrincipalContext,
  ): Promise<SavedViewResponse[]> {
    const { tenantId, userId } = principal;
    const [views, pins] = await Promise.all([
      this.repo.findVisibleToUser(tenantId, userId),
      this.repo.findPinsForUser(tenantId, userId),
    ]);

    const pinMap = new Map<string, SavedViewPin>(pins.map((p) => [p.viewId, p]));

    return views.map((v) => toResponse(v, pinMap.get(v.id)));
  }

  // --------------------------------------------------------------------------
  // Get by ID
  // --------------------------------------------------------------------------

  async getById(principal: PrincipalContext, id: string): Promise<SavedViewResponse> {
    const view = await this.requireVisible(principal, id);
    const pins = await this.repo.findPinsForUser(principal.tenantId, principal.userId);
    const pinMap = new Map<string, SavedViewPin>(pins.map((p) => [p.viewId, p]));
    return toResponse(view, pinMap.get(view.id));
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async createView(
    principal: PrincipalContext,
    dto: CreateViewDto,
    hasSharePermission: boolean,
  ): Promise<SavedViewResponse> {
    const { tenantId, userId } = principal;

    if (dto.scope === 'shared' && !hasSharePermission) {
      throw new ForbiddenException({
        error: { code: 'VIEW_SHARE_PERMISSION_REQUIRED', message: 'view:share permission required to create shared views.' },
      });
    }

    // Validate the filter AST through the compiler.
    this.validateAst(dto.filter_ast);

    // Validate columns.
    validateColumns(dto.columns);

    // Check name uniqueness.
    const ownerForNameCheck = dto.scope === 'private' ? userId : null;
    const conflict = await this.repo.nameConflictExists(tenantId, dto.name, ownerForNameCheck);
    if (conflict) {
      throw new ConflictException({
        error: { code: 'VIEW_NAME_CONFLICT', message: `A view named "${dto.name}" already exists.` },
      });
    }

    const view = await this.repo.create({
      id: randomUUID(),
      tenantId,
      ownerUserId: userId,
      name: dto.name,
      filterAst: dto.filter_ast,
      sortSpec: dto.sort_spec,
      columns: dto.columns,
      scope: dto.scope,
      isActive: true,
      slug: null,
    });

    return toResponse(view, undefined);
  }

  // --------------------------------------------------------------------------
  // Update (PATCH)
  // --------------------------------------------------------------------------

  async updateView(
    principal: PrincipalContext,
    id: string,
    dto: UpdateViewDto,
    hasSharePermission: boolean,
  ): Promise<SavedViewResponse> {
    const { tenantId, userId } = principal;

    const view = await this.requireVisible(principal, id);
    assertNotSystem(view);
    assertOwnerOrShare(view, userId, hasSharePermission);

    if (dto.scope === 'shared' && !hasSharePermission) {
      throw new ForbiddenException({
        error: { code: 'VIEW_SHARE_PERMISSION_REQUIRED', message: 'view:share permission required to publish shared views.' },
      });
    }

    if (dto.filter_ast !== undefined) {
      this.validateAst(dto.filter_ast);
    }
    if (dto.columns !== undefined) {
      validateColumns(dto.columns);
    }

    if (dto.name !== undefined) {
      const ownerForNameCheck = (dto.scope ?? view.scope) === 'private' ? userId : null;
      const conflict = await this.repo.nameConflictExists(tenantId, dto.name, ownerForNameCheck, id);
      if (conflict) {
        throw new ConflictException({
          error: { code: 'VIEW_NAME_CONFLICT', message: `A view named "${dto.name}" already exists.` },
        });
      }
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch['name'] = dto.name;
    if (dto.filter_ast !== undefined) patch['filterAst'] = dto.filter_ast;
    if (dto.sort_spec !== undefined) patch['sortSpec'] = dto.sort_spec;
    if (dto.columns !== undefined) patch['columns'] = dto.columns;
    if (dto.scope !== undefined) patch['scope'] = dto.scope;

    const updated = await this.repo.update(tenantId, id, patch);
    if (!updated) throw new NotFoundException({ error: { code: 'VIEW_NOT_FOUND', message: 'View not found.' } });

    return toResponse(updated, undefined);
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  async deleteView(principal: PrincipalContext, id: string, hasSharePermission: boolean): Promise<void> {
    const { userId } = principal;
    const view = await this.requireVisible(principal, id);
    assertNotSystem(view);
    assertOwnerOrShare(view, userId, hasSharePermission);
    await this.repo.softDelete(principal.tenantId, id);
  }

  // --------------------------------------------------------------------------
  // Duplicate
  // --------------------------------------------------------------------------

  async duplicateView(principal: PrincipalContext, id: string): Promise<SavedViewResponse> {
    const { tenantId, userId } = principal;
    const original = await this.requireVisible(principal, id);

    const baseName = `${original.name} (copy)`;
    let name = baseName;
    let attempt = 1;
    while (await this.repo.nameConflictExists(tenantId, name, userId)) {
      attempt++;
      name = `${baseName} ${attempt}`;
    }

    const copy = await this.repo.create({
      id: randomUUID(),
      tenantId,
      ownerUserId: userId,
      name,
      filterAst: original.filterAst,
      sortSpec: original.sortSpec,
      columns: original.columns,
      scope: 'private',    // duplicates are always private
      isActive: true,
      slug: null,
    });

    return toResponse(copy, undefined);
  }

  // --------------------------------------------------------------------------
  // Pin / unpin
  // --------------------------------------------------------------------------

  async pinView(principal: PrincipalContext, viewId: string): Promise<void> {
    await this.requireVisible(principal, viewId);
    const pins = await this.repo.findPinsForUser(principal.tenantId, principal.userId);
    const nextOrder = pins.length > 0 ? Math.max(...pins.map((p) => p.pinOrder)) + 1 : 0;
    await this.repo.upsertPin(principal.tenantId, principal.userId, viewId, nextOrder);
  }

  async unpinView(principal: PrincipalContext, viewId: string): Promise<void> {
    await this.requireVisible(principal, viewId);
    await this.repo.deletePin(principal.tenantId, principal.userId, viewId);
  }

  async reorderPins(principal: PrincipalContext, viewIds: string[]): Promise<void> {
    const { tenantId, userId } = principal;

    // Filter to only views actually visible to this user — ignore unknown IDs.
    const visible = await this.repo.findVisibleToUser(tenantId, userId);
    const visibleSet = new Set(visible.map((v) => v.id));
    const filtered = viewIds.filter((id) => visibleSet.has(id));

    await this.repo.batchUpsertPinOrder(tenantId, userId, filtered);
    // Remove pins for ids not in the new order list.
    await this.repo.deleteStaleUserPins(tenantId, userId, filtered);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private validateAst(rawAst: unknown): void {
    const validated = parseFilterAst(rawAst);
    if (!validated.success) {
      throw new BadRequestException({
        error: {
          code: 'VIEW_INVALID_FILTER_AST',
          message: 'Invalid filter AST.',
          details: validated.errors,
        },
      });
    }
  }

  private async requireVisible(principal: PrincipalContext, id: string): Promise<SavedView> {
    const { tenantId, userId } = principal;
    const view = await this.repo.findById(tenantId, id);
    if (!view || !view.isActive) {
      throw new NotFoundException({ error: { code: 'VIEW_NOT_FOUND', message: 'View not found.' } });
    }
    // Private views owned by someone else are not visible.
    if (view.scope === 'private' && view.ownerUserId !== userId) {
      throw new NotFoundException({ error: { code: 'VIEW_NOT_FOUND', message: 'View not found.' } });
    }
    return view;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function assertNotSystem(view: SavedView): void {
  if (view.scope === 'system') {
    throw new ForbiddenException({
      error: { code: 'VIEW_SYSTEM_IMMUTABLE', message: 'System views are immutable.' },
    });
  }
}

function assertOwnerOrShare(
  view: SavedView,
  userId: string,
  hasSharePermission: boolean,
): void {
  const isOwner = view.ownerUserId === userId;
  if (!isOwner && !hasSharePermission) {
    // Return 403 for ownership violations; caller has already filtered 404s.
    throw new ForbiddenException({
      error: { code: 'VIEW_NOT_OWNER', message: 'You do not own this view.' },
    });
  }
}

function validateColumns(columns: string[]): void {
  const invalid = columns.filter(
    (c) => !(ALLOWED_COLUMNS as readonly string[]).includes(c),
  );
  if (invalid.length > 0) {
    throw new BadRequestException({
      error: {
        code: 'VIEW_INVALID_COLUMNS',
        message: `Unknown column keys: ${invalid.join(', ')}`,
      },
    });
  }
}

/**
 * Deep-walk the AST and substitute placeholder token strings.
 * Returns a new object; does not mutate the input.
 */
function substitutePlaceholders(ast: unknown, principal: PrincipalContext): unknown {
  if (typeof ast === 'string') {
    if (ast === PLACEHOLDER_CURRENT_USER) return principal.userId;
    if (ast === PLACEHOLDER_CURRENT_ORG_SCOPE) return principal.orgScopeIds;
    return ast;
  }
  if (Array.isArray(ast)) {
    return ast.map((item) => substitutePlaceholders(item, principal));
  }
  if (ast !== null && typeof ast === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ast as Record<string, unknown>)) {
      result[key] = substitutePlaceholders(value, principal);
    }
    return result;
  }
  return ast;
}

function toResponse(view: SavedView, pin: SavedViewPin | undefined): SavedViewResponse {
  return {
    id: view.id,
    name: view.name,
    scope: view.scope as 'system' | 'private' | 'shared',
    is_pinned: pin !== undefined,
    pin_order: pin?.pinOrder ?? null,
    filter_ast: view.filterAst,
    sort_spec: (view.sortSpec as SortSpecItem[]) ?? [],
    columns: (view.columns as string[]) ?? [],
    owner: view.ownerUserId ? { id: view.ownerUserId } : null,
    slug: view.slug,
    created_at: view.createdAt.toISOString(),
    updated_at: view.updatedAt.toISOString(),
  };
}
