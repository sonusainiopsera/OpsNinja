import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CategoriesService, CategoriesError } from '../categories.service.js';
import { CategoriesRepository, type CategoryRecord } from '../categories.repository.js';
import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Mocking helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<CategoryRecord> = {}): CategoryRecord {
  return {
    id: 'cat-1',
    tenantId: 'tenant-a',
    parentId: null,
    name: 'Pipeline',
    slug: 'pipeline',
    path: 'pipeline',
    depth: 0,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const TENANT = 'tenant-a';

function makeSql(): Sql {
  return {
    unsafe: vi.fn().mockResolvedValue([]),
  } as unknown as Sql;
}

function makeRepo(): CategoriesRepository {
  const repo = new CategoriesRepository();
  vi.spyOn(repo, 'findById').mockResolvedValue(null);
  vi.spyOn(repo, 'findAll').mockResolvedValue([]);
  vi.spyOn(repo, 'findSiblings').mockResolvedValue([]);
  vi.spyOn(repo, 'findSubtree').mockResolvedValue([]);
  vi.spyOn(repo, 'create').mockResolvedValue(makeRecord());
  vi.spyOn(repo, 'update').mockResolvedValue(makeRecord());
  vi.spyOn(repo, 'deactivate').mockResolvedValue(makeRecord({ isActive: false }));
  vi.spyOn(repo, 'reparent').mockResolvedValue([makeRecord()]);
  vi.spyOn(repo, 'maxSortOrder').mockResolvedValue(-1);
  return repo;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CategoriesService.create', () => {
  let repo: CategoriesRepository;
  let service: CategoriesService;
  let sql: Sql;

  beforeEach(() => {
    repo = makeRepo();
    service = new CategoriesService(repo, null);
    sql = makeSql();
  });

  it('creates a root category', async () => {
    const node = await service.create(sql, TENANT, { name: 'Pipeline' });
    expect(repo.create).toHaveBeenCalledWith(sql, expect.objectContaining({
      name: 'Pipeline',
      slug: 'pipeline',
      path: 'pipeline',
      depth: 0,
      parentId: null,
    }));
    expect(node).toBeDefined();
  });

  it('throws CATEGORY_DUPLICATE when sibling name conflicts', async () => {
    vi.spyOn(repo, 'findSiblings').mockResolvedValue([makeRecord({ name: 'Pipeline' })]);

    await expect(service.create(sql, TENANT, { name: 'Pipeline' })).rejects.toMatchObject({
      code: 'CATEGORY_DUPLICATE',
    });
  });

  it('throws CATEGORY_DUPLICATE for case-insensitive name match', async () => {
    vi.spyOn(repo, 'findSiblings').mockResolvedValue([makeRecord({ name: 'pipeline' })]);

    await expect(service.create(sql, TENANT, { name: 'PIPELINE' })).rejects.toMatchObject({
      code: 'CATEGORY_DUPLICATE',
    });
  });

  it('throws CATEGORY_DEPTH_LIMIT when parent is at max depth', async () => {
    const parentAtDepth2 = makeRecord({ id: 'p', depth: 2, path: 'a/b/c' });
    vi.spyOn(repo, 'findById').mockResolvedValue(parentAtDepth2);

    await expect(
      service.create(sql, TENANT, { name: 'Too Deep', parentId: 'p' }),
    ).rejects.toMatchObject({ code: 'CATEGORY_DEPTH_LIMIT' });
  });

  it('creates child category with correct path', async () => {
    const parent = makeRecord({ id: 'p', depth: 0, path: 'pipeline', slug: 'pipeline' });
    vi.spyOn(repo, 'findById').mockResolvedValue(parent);
    vi.spyOn(repo, 'create').mockImplementation(async (_, params) =>
      makeRecord({ ...params, id: 'child-1' }),
    );

    await service.create(sql, TENANT, { name: 'Jenkins', parentId: 'p' });
    expect(repo.create).toHaveBeenCalledWith(sql, expect.objectContaining({
      path: 'pipeline/jenkins',
      depth: 1,
      parentId: 'p',
    }));
  });

  it('throws CATEGORY_NOT_FOUND when parent does not exist', async () => {
    vi.spyOn(repo, 'findById').mockResolvedValue(null);

    await expect(
      service.create(sql, TENANT, { name: 'Child', parentId: 'nonexistent' }),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });
});

describe('CategoriesService.reparent', () => {
  let repo: CategoriesRepository;
  let service: CategoriesService;
  let sql: Sql;

  beforeEach(() => {
    repo = makeRepo();
    service = new CategoriesService(repo, null);
    sql = makeSql();
  });

  it('calls repository reparent on valid move', async () => {
    const node = makeRecord({ id: 'node', path: 'pipeline/ci', depth: 1, slug: 'ci' });
    const newParent = makeRecord({ id: 'secrets', path: 'secrets', depth: 0, slug: 'secrets' });
    vi.spyOn(repo, 'findById')
      .mockResolvedValueOnce(node)
      .mockResolvedValueOnce(newParent);
    vi.spyOn(repo, 'findSubtree').mockResolvedValue([node]);
    vi.spyOn(repo, 'findSiblings').mockResolvedValue([]);

    await service.reparent(sql, TENANT, 'node', 'secrets');
    expect(repo.reparent).toHaveBeenCalled();
  });

  it('throws CATEGORY_CYCLE when target is a descendant', async () => {
    const node = makeRecord({ id: 'pipeline', path: 'pipeline', depth: 0 });
    const descendant = makeRecord({ id: 'ci', path: 'pipeline/ci', depth: 1, parentId: 'pipeline' });
    vi.spyOn(repo, 'findById')
      .mockResolvedValueOnce(node)
      .mockResolvedValueOnce(descendant);
    vi.spyOn(repo, 'findSubtree').mockResolvedValue([node]);

    await expect(service.reparent(sql, TENANT, 'pipeline', 'ci')).rejects.toMatchObject({
      code: 'CATEGORY_CYCLE',
    });
  });

  it('throws CATEGORY_CYCLE when target is itself', async () => {
    const node = makeRecord({ id: 'pipeline', path: 'pipeline', depth: 0 });
    vi.spyOn(repo, 'findById')
      .mockResolvedValueOnce(node)
      .mockResolvedValueOnce(node);
    vi.spyOn(repo, 'findSubtree').mockResolvedValue([node]);

    await expect(service.reparent(sql, TENANT, 'pipeline', 'pipeline')).rejects.toMatchObject({
      code: 'CATEGORY_CYCLE',
    });
  });

  it('throws CATEGORY_NOT_FOUND when node does not exist', async () => {
    vi.spyOn(repo, 'findById').mockResolvedValue(null);

    await expect(service.reparent(sql, TENANT, 'ghost', 'parent')).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
    });
  });

  it('allows reparent to root (null parent)', async () => {
    const node = makeRecord({ id: 'ci', path: 'pipeline/ci', depth: 1, parentId: 'pipeline' });
    vi.spyOn(repo, 'findById').mockResolvedValue(node);
    vi.spyOn(repo, 'findSubtree').mockResolvedValue([node]);
    vi.spyOn(repo, 'findSiblings').mockResolvedValue([]);

    await service.reparent(sql, TENANT, 'ci', null);
    expect(repo.reparent).toHaveBeenCalledWith(
      sql, TENANT, 'ci', null, null, -1,
    );
  });
});

describe('CategoriesService.deactivate', () => {
  it('marks the node as inactive', async () => {
    const repo = makeRepo();
    const node = makeRecord();
    vi.spyOn(repo, 'findById').mockResolvedValue(node);

    const service = new CategoriesService(repo, null);
    const sql = makeSql();
    const result = await service.deactivate(sql, TENANT, 'cat-1');

    expect(result.isActive).toBe(false);
    expect(repo.deactivate).toHaveBeenCalledWith(sql, TENANT, 'cat-1');
  });

  it('throws CATEGORY_NOT_FOUND for unknown id', async () => {
    const repo = makeRepo();
    vi.spyOn(repo, 'findById').mockResolvedValue(null);

    const service = new CategoriesService(repo, null);
    const sql = makeSql();

    await expect(service.deactivate(sql, TENANT, 'ghost')).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
    });
  });
});
