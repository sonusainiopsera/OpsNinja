import {
  Injectable,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { type SavedView } from '@opsninja/db';
import { SavedViewService } from './saved-view.service';
import { ViewsRepository } from './views.repository';
import { AuditWriter } from '../../common/audit/audit-writer';
import { assertFound } from '../../common/errors/not-found';
import { RequestContextStore } from '../../observability/request-context';
import type { CreateViewDto, PatchViewDto, ViewResponse } from './dto/save-view.dto';
import { Permission } from '../../common/auth/permissions';

const PLACEHOLDER_CURRENT_USER = 'CURRENT_USER';
const PLACEHOLDER_CURRENT_ORG = 'CURRENT_ORG_SCOPE';

@Injectable()
export class ViewsService {
  constructor(
    private readonly repo: ViewsRepository,
    private readonly filterService: SavedViewService,
    private readonly auditWriter: AuditWriter,
  ) {}

  // ── List ───────────────────────────────────────────────────────────────────

  async listViews(): Promise<ViewResponse[]> {
    const { userId } = RequestContextStore.getPrincipal();
    const rows = await this.repo.listVisibleForUser(userId);

    return rows
      .sort((a, b) => {
        const aOrder = a.pin_order ?? Infinity;
        const bOrder = b.pin_order ?? Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      })
      .map((row) => this.toResponse(row, row.pin_order));
  }

  // ── Get one ────────────────────────────────────────────────────────────────

  async getView(id: string): Promise<ViewResponse> {
    const { userId } = RequestContextStore.getPrincipal();
    const view = await this.repo.findByIdVisible(id, userId);
    assertFound(view, 'View');

    const pin = await this.repo.getPinForUser(userId, id);
    return this.toResponse(view, pin?.pinOrder ?? null);
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async createView(dto: CreateViewDto): Promise<ViewResponse> {
    const principal = RequestContextStore.getPrincipal();
    const { userId, tenantId } = principal;

    if (dto.scope === 'shared') {
      this.assertSharePermission(principal.permissions);
    }

    const { ast, signature } = this.filterService.validateAndPrepare(dto.filter_ast);

    await this.assertNameAvailable(dto.name, userId, null);

    const view = await this.repo.create({
      tenantId,
      ownerUserId: userId,
      name: dto.name,
      filterAst: ast,
      sortSpec: dto.sort_spec ?? [],
      columns: dto.columns ?? [],
      scope: dto.scope,
      isActive: true,
      astSignature: signature,
    });

    await this.auditWriter.append({
      action: 'view.created',
      resourceType: 'view',
      resourceId: view.id,
      afterState: { id: view.id, name: view.name, scope: view.scope, ast_signature: signature },
      metadata: { ast_signature: signature },
      forceEmit: true,
    });

    return this.toResponse(view, null);
  }

  // ── Patch ──────────────────────────────────────────────────────────────────

  async patchView(id: string, dto: PatchViewDto): Promise<ViewResponse> {
    const principal = RequestContextStore.getPrincipal();
    const { userId } = principal;
    const view = await this.repo.findByIdVisible(id, userId);
    assertFound(view, 'View');

    this.assertNotSystem(view);
    this.assertOwnership(view, userId);

    if (dto.scope === 'shared' || (dto.scope === undefined && view.scope === 'shared')) {
      this.assertSharePermission(principal.permissions);
    }

    const patch: Parameters<ViewsRepository['update']>[1] = {};
    let newSignature = view.astSignature;

    if (dto.filter_ast !== undefined) {
      const { ast, signature } = this.filterService.validateAndPrepare(dto.filter_ast);
      patch.filterAst = ast;
      patch.astSignature = signature;
      newSignature = signature;
    }

    if (dto.name !== undefined && dto.name !== view.name) {
      await this.assertNameAvailable(dto.name, userId, id);
      patch.name = dto.name;
    }

    if (dto.sort_spec !== undefined) patch.sortSpec = dto.sort_spec;
    if (dto.columns !== undefined) patch.columns = dto.columns;
    if (dto.scope !== undefined) patch.scope = dto.scope;

    const updated = await this.repo.update(id, patch);
    assertFound(updated, 'View');

    await this.auditWriter.append({
      action: 'view.updated',
      resourceType: 'view',
      resourceId: id,
      afterState: { id, ast_signature: newSignature, ...patch },
      metadata: { ast_signature: newSignature },
      forceEmit: true,
    });

    const pin = await this.repo.getPinForUser(userId, id);
    return this.toResponse(updated, pin?.pinOrder ?? null);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async deleteView(id: string): Promise<void> {
    const { userId } = RequestContextStore.getPrincipal();
    const view = await this.repo.findByIdVisible(id, userId);
    assertFound(view, 'View');

    this.assertNotSystem(view);
    this.assertOwnership(view, userId);

    await this.repo.softDelete(id);

    await this.auditWriter.append({
      action: 'view.deleted',
      resourceType: 'view',
      resourceId: id,
      metadata: { ast_signature: view.astSignature },
      forceEmit: true,
    });
  }

  // ── Duplicate ──────────────────────────────────────────────────────────────

  async duplicateView(id: string): Promise<ViewResponse> {
    const { userId, tenantId } = RequestContextStore.getPrincipal();
    const original = await this.repo.findByIdVisible(id, userId);
    assertFound(original, 'View');

    const baseName = `Copy of ${original.name}`;
    const uniqueName = await this.findUniqueCopyName(baseName, userId);

    const copy = await this.repo.create({
      tenantId,
      ownerUserId: userId,
      name: uniqueName,
      filterAst: original.filterAst,
      sortSpec: original.sortSpec,
      columns: original.columns,
      scope: 'private',
      isActive: true,
      astSignature: original.astSignature,
    });

    await this.auditWriter.append({
      action: 'view.duplicated',
      resourceType: 'view',
      resourceId: copy.id,
      metadata: { source_id: id, ast_signature: copy.astSignature },
      forceEmit: true,
    });

    return this.toResponse(copy, null);
  }

  // ── Pin toggle ─────────────────────────────────────────────────────────────

  async pinView(id: string): Promise<void> {
    const { userId, tenantId } = RequestContextStore.getPrincipal();
    const view = await this.repo.findByIdVisible(id, userId);
    assertFound(view, 'View');

    const existing = await this.repo.listVisibleForUser(userId);
    const maxOrder = existing
      .filter((v) => v.pin_order !== null)
      .reduce((m, v) => Math.max(m, v.pin_order!), -1);

    await this.repo.upsertPin(tenantId, userId, id, maxOrder + 1);
  }

  async unpinView(id: string): Promise<void> {
    const { userId } = RequestContextStore.getPrincipal();
    const view = await this.repo.findByIdVisible(id, userId);
    assertFound(view, 'View');

    await this.repo.deletePin(userId, id);
  }

  // ── Reorder pins ───────────────────────────────────────────────────────────

  async reorderPins(viewIds: string[]): Promise<void> {
    const { userId, tenantId } = RequestContextStore.getPrincipal();

    const visible = await this.repo.listVisibleForUser(userId);
    const visibleIds = new Set(visible.map((v) => v.id));

    const filtered = viewIds.filter((id) => visibleIds.has(id));

    await this.repo.reorderPins(tenantId, userId, filtered);
  }

  // ── Placeholder substitution ───────────────────────────────────────────────

  substituteAstPlaceholders(ast: unknown): unknown {
    const principal = RequestContextStore.getPrincipal();
    const json = JSON.stringify(ast);
    const replaced = json
      .replace(new RegExp(`"${PLACEHOLDER_CURRENT_USER}"`, 'g'), `"${principal.userId}"`)
      .replace(new RegExp(`"${PLACEHOLDER_CURRENT_ORG}"`, 'g'), JSON.stringify(principal.orgScopeIds));
    return JSON.parse(replaced);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private assertNotSystem(view: SavedView): void {
    if (view.scope === 'system') {
      throw new ForbiddenException({
        code: 'VIEW_SYSTEM_IMMUTABLE',
        message: 'System views are immutable.',
      });
    }
  }

  private assertOwnership(view: SavedView, userId: string): void {
    if (view.ownerUserId !== userId) {
      throw new ForbiddenException({
        code: 'VIEW_NOT_OWNER',
        message: 'You do not own this view.',
      });
    }
  }

  private assertSharePermission(perms?: ReadonlySet<string>): void {
    if (!perms?.has(Permission.VIEWS_SHARE)) {
      throw new ForbiddenException({
        code: 'VIEWS_SHARE_REQUIRED',
        message: 'Publishing shared views requires the views:share permission.',
      });
    }
  }

  private async assertNameAvailable(name: string, ownerUserId: string, excludeId: string | null): Promise<void> {
    const existing = await this.repo.findByNameForOwner(name, ownerUserId);
    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        code: 'VIEW_NAME_CONFLICT',
        message: `A view named "${name}" already exists.`,
      });
    }
  }

  private async findUniqueCopyName(baseName: string, userId: string): Promise<string> {
    let name = baseName;
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const conflict = await this.repo.findByNameForOwner(name, userId);
      if (!conflict) return name;
      suffix++;
      name = `${baseName} (${suffix})`;
    }
  }

  private toResponse(
    view: SavedView,
    pinOrder: number | null,
  ): ViewResponse {
    const isPinned = pinOrder !== null;
    return {
      id: view.id,
      name: view.name,
      scope: view.scope,
      is_pinned: isPinned,
      pin_order: isPinned ? pinOrder : null,
      filter_ast: view.filterAst,
      sort_spec: (view.sortSpec as { field: string; direction: 'asc' | 'desc' }[]) ?? [],
      columns: view.columns ?? [],
      owner: view.ownerUserId ? { id: view.ownerUserId } : null,
      updated_at: view.updatedAt.toISOString(),
    };
  }
}
