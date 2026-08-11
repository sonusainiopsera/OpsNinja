/**
 * Unit tests for ViewsService covering:
 * - AST validation rejection
 * - System-view immutability
 * - Ownership enforcement
 * - Pin ordering idempotency
 * - Placeholder substitution
 * - Duplicate name conflict
 */

import { ForbiddenException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ViewsService } from '../views.service';
import type { SavedView } from '@opsninja/db';
import { Permission } from '../../../common/auth/permissions';

// ── Fakes ─────────────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaa0000-0000-0000-0000-000000000001';
const USER_A    = 'bbbb0000-0000-0000-0000-000000000002';
const USER_B    = 'cccc0000-0000-0000-0000-000000000003';
const VIEW_ID   = 'dddd0000-0000-0000-0000-000000000004';

function makeView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: VIEW_ID,
    tenantId: TENANT_ID,
    ownerUserId: USER_A,
    name: 'My View',
    filterAst: { type: 'group', op: 'AND', children: [] },
    sortSpec: [],
    columns: [],
    scope: 'private',
    isActive: true,
    astSignature: 'abc123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Mock RequestContextStore
jest.mock('../../../observability/request-context', () => ({
  RequestContextStore: {
    getPrincipal: jest.fn(),
  },
}));

import { RequestContextStore } from '../../../observability/request-context';

const mockPrincipal = (overrides: Record<string, unknown> = {}) => {
  (RequestContextStore.getPrincipal as jest.Mock).mockReturnValue({
    tenantId: TENANT_ID,
    userId: USER_A,
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: [],
    traceId: 'trace-1',
    permissions: new Set([Permission.TICKETS_READ]),
    ...overrides,
  });
};

// ── Repo fake ─────────────────────────────────────────────────────────────────

const mockRepo = {
  listVisibleForUser: jest.fn(),
  findById: jest.fn(),
  findByIdVisible: jest.fn(),
  findByNameForOwner: jest.fn(),
  findSystemViewsBySlug: jest.fn(),
  countSystemViews: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  getPinForUser: jest.fn(),
  upsertPin: jest.fn(),
  deletePin: jest.fn(),
  reorderPins: jest.fn(),
};

const mockFilterService = {
  validateAndPrepare: jest.fn(),
  compile: jest.fn(),
};

const mockAuditWriter = {
  append: jest.fn(),
  appendBatch: jest.fn(),
};

function makeService(): ViewsService {
  return new ViewsService(
    mockRepo as any,
    mockFilterService as any,
    mockAuditWriter as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ViewsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── AST validation ─────────────────────────────────────────────────────────

  describe('createView', () => {
    it('throws BadRequestException when filterService rejects the AST', async () => {
      mockPrincipal();
      mockFilterService.validateAndPrepare.mockImplementation(() => {
        throw new BadRequestException({ message: 'Invalid filter AST structure', errors: [] });
      });
      mockRepo.findByNameForOwner.mockResolvedValue(undefined);

      const svc = makeService();
      await expect(
        svc.createView({ name: 'Bad View', filter_ast: { bad: true }, scope: 'private' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does NOT persist a row when the AST is invalid', async () => {
      mockPrincipal();
      mockFilterService.validateAndPrepare.mockImplementation(() => {
        throw new BadRequestException({ message: 'bad', errors: [] });
      });

      const svc = makeService();
      await expect(svc.createView({ name: 'X', filter_ast: {}, scope: 'private' })).rejects.toThrow();
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('persists the view when AST is valid', async () => {
      mockPrincipal();
      const ast = { type: 'group', op: 'AND', children: [] };
      mockFilterService.validateAndPrepare.mockReturnValue({ ast, signature: 'sig-1' });
      mockRepo.findByNameForOwner.mockResolvedValue(undefined);
      const created = makeView({ astSignature: 'sig-1' });
      mockRepo.create.mockResolvedValue(created);
      mockAuditWriter.append.mockResolvedValue(undefined);

      const svc = makeService();
      const result = await svc.createView({ name: 'Good View', filter_ast: ast, scope: 'private' });
      expect(mockRepo.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(VIEW_ID);
    });

    it('throws 409 when a view with the same name already exists', async () => {
      mockPrincipal();
      const ast = { type: 'group', op: 'AND', children: [] };
      mockFilterService.validateAndPrepare.mockReturnValue({ ast, signature: 'sig-1' });
      mockRepo.findByNameForOwner.mockResolvedValue(makeView({ id: 'other-id' }));

      const svc = makeService();
      await expect(svc.createView({ name: 'My View', filter_ast: ast, scope: 'private' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws 403 when trying to create a shared view without VIEWS_SHARE permission', async () => {
      mockPrincipal({ permissions: new Set([Permission.TICKETS_READ]) });
      const ast = { type: 'group', op: 'AND', children: [] };
      mockFilterService.validateAndPrepare.mockReturnValue({ ast, signature: 'sig-1' });

      const svc = makeService();
      await expect(svc.createView({ name: 'Shared', filter_ast: ast, scope: 'shared' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows creating a shared view with VIEWS_SHARE permission', async () => {
      mockPrincipal({ permissions: new Set([Permission.TICKETS_READ, Permission.VIEWS_SHARE]) });
      const ast = { type: 'group', op: 'AND', children: [] };
      mockFilterService.validateAndPrepare.mockReturnValue({ ast, signature: 'sig-1' });
      mockRepo.findByNameForOwner.mockResolvedValue(undefined);
      const created = makeView({ scope: 'shared' });
      mockRepo.create.mockResolvedValue(created);
      mockAuditWriter.append.mockResolvedValue(undefined);

      const svc = makeService();
      const result = await svc.createView({ name: 'Shared View', filter_ast: ast, scope: 'shared' });
      expect(result.scope).toBe('shared');
    });
  });

  // ── System-view immutability ───────────────────────────────────────────────

  describe('patchView / deleteView on system views', () => {
    it('throws 403 when patching a system view', async () => {
      mockPrincipal();
      const sysView = makeView({ scope: 'system', ownerUserId: null });
      mockRepo.findByIdVisible.mockResolvedValue(sysView);

      const svc = makeService();
      await expect(svc.patchView(VIEW_ID, { name: 'Renamed' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 403 when deleting a system view', async () => {
      mockPrincipal();
      const sysView = makeView({ scope: 'system', ownerUserId: null });
      mockRepo.findByIdVisible.mockResolvedValue(sysView);

      const svc = makeService();
      await expect(svc.deleteView(VIEW_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── Ownership enforcement ─────────────────────────────────────────────────

  describe('ownership checks', () => {
    it('throws 403 when user B tries to patch user A's view', async () => {
      mockPrincipal({ userId: USER_B });
      // View is owned by USER_A; USER_B can see it only if shared; but private views are filtered by repo
      // For this test, assume repo returns the view (simulating shared scope accessible but not owned)
      const view = makeView({ ownerUserId: USER_A, scope: 'private' });
      mockRepo.findByIdVisible.mockResolvedValue(view);

      const svc = makeService();
      await expect(svc.patchView(VIEW_ID, { name: 'Hijacked' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 403 when user B tries to delete user A's view', async () => {
      mockPrincipal({ userId: USER_B });
      const view = makeView({ ownerUserId: USER_A });
      mockRepo.findByIdVisible.mockResolvedValue(view);

      const svc = makeService();
      await expect(svc.deleteView(VIEW_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 404 when view is not visible to the principal', async () => {
      mockPrincipal();
      mockRepo.findByIdVisible.mockResolvedValue(undefined);

      const svc = makeService();
      await expect(svc.getView(VIEW_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── Pin ordering idempotency ──────────────────────────────────────────────

  describe('reorderPins', () => {
    it('ignores view ids that are not visible to the principal', async () => {
      mockPrincipal();
      const visibleView = makeView({ id: VIEW_ID, pin_order: 0 } as any);
      mockRepo.listVisibleForUser.mockResolvedValue([visibleView]);
      mockRepo.reorderPins.mockResolvedValue(undefined);

      const svc = makeService();
      const unknownId = 'ffffffff-0000-0000-0000-000000000099';
      await svc.reorderPins([VIEW_ID, unknownId]);

      expect(mockRepo.reorderPins).toHaveBeenCalledWith(TENANT_ID, USER_A, [VIEW_ID]);
    });

    it('is idempotent — calling with the same order twice calls reorderPins both times', async () => {
      mockPrincipal();
      const visibleView = makeView({ id: VIEW_ID, pin_order: 0 } as any);
      mockRepo.listVisibleForUser.mockResolvedValue([visibleView]);
      mockRepo.reorderPins.mockResolvedValue(undefined);

      const svc = makeService();
      await svc.reorderPins([VIEW_ID]);
      await svc.reorderPins([VIEW_ID]);

      expect(mockRepo.reorderPins).toHaveBeenCalledTimes(2);
    });
  });

  // ── Placeholder substitution ──────────────────────────────────────────────

  describe('substituteAstPlaceholders', () => {
    it('replaces CURRENT_USER with principal userId', () => {
      mockPrincipal({ userId: USER_A, orgScopeIds: [] });
      const svc = makeService();
      const ast = { type: 'condition', field: 'assignee_id', operator: 'eq', value: 'CURRENT_USER' };
      const result = svc.substituteAstPlaceholders(ast) as Record<string, unknown>;
      expect(result.value).toBe(USER_A);
    });

    it('replaces CURRENT_ORG_SCOPE with orgScopeIds array', () => {
      const orgIds = ['org-1', 'org-2'];
      mockPrincipal({ userId: USER_A, orgScopeIds: orgIds });
      const svc = makeService();
      const ast = { type: 'condition', field: 'organization_id', operator: 'in', value: 'CURRENT_ORG_SCOPE' };
      const result = svc.substituteAstPlaceholders(ast) as Record<string, unknown>;
      expect(result.value).toEqual(orgIds);
    });

    it('leaves unrelated fields unchanged', () => {
      mockPrincipal({ userId: USER_A, orgScopeIds: [] });
      const svc = makeService();
      const ast = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
      const result = svc.substituteAstPlaceholders(ast) as Record<string, unknown>;
      expect(result.value).toBe('open');
    });
  });

  // ── Duplicate ─────────────────────────────────────────────────────────────

  describe('duplicateView', () => {
    it('creates a private copy with "Copy of" prefix', async () => {
      mockPrincipal();
      const original = makeView({ name: 'Source View', scope: 'system', ownerUserId: null });
      mockRepo.findByIdVisible.mockResolvedValue(original);
      mockRepo.findByNameForOwner.mockResolvedValue(undefined);
      const copy = makeView({ id: 'copy-id', name: 'Copy of Source View', scope: 'private' });
      mockRepo.create.mockResolvedValue(copy);
      mockAuditWriter.append.mockResolvedValue(undefined);

      const svc = makeService();
      const result = await svc.duplicateView(VIEW_ID);
      expect(result.scope).toBe('private');
      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ scope: 'private', name: 'Copy of Source View' }));
    });
  });
});
