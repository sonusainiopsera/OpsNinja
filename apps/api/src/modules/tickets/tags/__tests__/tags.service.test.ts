import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TagsService, TagsError } from '../tags.service.js';
import { TagsRepository, type TagRecord } from '../tags.repository.js';
import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'eeeeeeee-0000-4000-8000-000000000001';

function makeTag(overrides: Partial<TagRecord> = {}): TagRecord {
  return {
    id:         'aaaaaaaa-0000-4000-8000-000000000001',
    tenantId:   TENANT_ID,
    name:       'Bug',
    slug:       'bug',
    colour:     null,
    isActive:   true,
    usageCount: 0,
    createdAt:  new Date('2024-01-01'),
    updatedAt:  new Date('2024-01-01'),
    ...overrides,
  };
}

const mockSql = {} as unknown as Sql;

// ---------------------------------------------------------------------------
// Tag cap enforcement
// ---------------------------------------------------------------------------

describe('TagsService.createTag — cap enforcement', () => {
  let repo: TagsRepository;
  let service: TagsService;

  beforeEach(() => {
    repo = new TagsRepository();
    service = new TagsService(repo, null, { maxTagsPerTenant: 3 });
  });

  it('throws TAG_CAP_EXCEEDED when active tag count equals cap', async () => {
    vi.spyOn(repo, 'countActive').mockResolvedValue(3);

    await expect(
      service.createTag(mockSql, TENANT_ID, { name: 'New Tag' }),
    ).rejects.toMatchObject({ code: 'TAG_CAP_EXCEEDED' });
  });

  it('throws TAG_CAP_EXCEEDED when active tag count exceeds cap', async () => {
    vi.spyOn(repo, 'countActive').mockResolvedValue(10);

    await expect(
      service.createTag(mockSql, TENANT_ID, { name: 'New Tag' }),
    ).rejects.toMatchObject({ code: 'TAG_CAP_EXCEEDED' });
  });

  it('creates tag when count is below cap', async () => {
    vi.spyOn(repo, 'countActive').mockResolvedValue(2);
    const tag = makeTag();
    vi.spyOn(repo, 'create').mockResolvedValue(tag);

    const result = await service.createTag(mockSql, TENANT_ID, { name: 'Bug' });
    expect(result.slug).toBe('bug');
  });
});

// ---------------------------------------------------------------------------
// Slug normalisation on create
// ---------------------------------------------------------------------------

describe('TagsService.createTag — slug normalisation', () => {
  let repo: TagsRepository;
  let service: TagsService;

  beforeEach(() => {
    repo = new TagsRepository();
    service = new TagsService(repo, null, { maxTagsPerTenant: 500 });
    vi.spyOn(repo, 'countActive').mockResolvedValue(0);
  });

  it('normalises name to slug before insert', async () => {
    let capturedParams: Parameters<TagsRepository['create']>[1] | null = null;
    vi.spyOn(repo, 'create').mockImplementation(async (_sql, params) => {
      capturedParams = params;
      return makeTag({ slug: params.slug });
    });

    await service.createTag(mockSql, TENANT_ID, { name: 'Bug Fix' });
    expect(capturedParams?.slug).toBe('bug-fix');
  });

  it('throws on empty-slug name', async () => {
    await expect(
      service.createTag(mockSql, TENANT_ID, { name: '!!!' }),
    ).rejects.toMatchObject({ code: 'TAG_DUPLICATE' });
  });
});

// ---------------------------------------------------------------------------
// Duplicate handling
// ---------------------------------------------------------------------------

describe('TagsService.createTag — conflict handling', () => {
  let repo: TagsRepository;
  let service: TagsService;

  beforeEach(() => {
    repo = new TagsRepository();
    service = new TagsService(repo, null);
    vi.spyOn(repo, 'countActive').mockResolvedValue(0);
  });

  it('throws TAG_DUPLICATE on conflict when returnExistingOnConflict=false', async () => {
    vi.spyOn(repo, 'create').mockResolvedValue(null);
    vi.spyOn(repo, 'findBySlug').mockResolvedValue(makeTag());

    await expect(
      service.createTag(mockSql, TENANT_ID, { name: 'Bug' }, { returnExistingOnConflict: false }),
    ).rejects.toMatchObject({ code: 'TAG_DUPLICATE' });
  });

  it('returns existing tag on conflict when returnExistingOnConflict=true', async () => {
    const existing = makeTag();
    vi.spyOn(repo, 'create').mockResolvedValue(null);
    vi.spyOn(repo, 'findBySlug').mockResolvedValue(existing);

    const result = await service.createTag(mockSql, TENANT_ID, { name: 'Bug' }, { returnExistingOnConflict: true });
    expect(result.id).toBe(existing.id);
  });
});

// ---------------------------------------------------------------------------
// Tag merge
// ---------------------------------------------------------------------------

describe('TagsService.mergeTags', () => {
  let repo: TagsRepository;
  let service: TagsService;

  beforeEach(() => {
    repo = new TagsRepository();
    service = new TagsService(repo, null);
  });

  it('throws TAG_SELF_MERGE when source and target are the same', async () => {
    await expect(
      service.mergeTags(mockSql, TENANT_ID, 'same-id', 'same-id'),
    ).rejects.toMatchObject({ code: 'TAG_SELF_MERGE' });
  });

  it('remaps ticket_tags and reports count', async () => {
    const source = makeTag({ id: 'source-id', slug: 'old-tag' });
    const target = makeTag({ id: 'target-id', slug: 'new-tag', usageCount: 5 });

    vi.spyOn(repo, 'findById')
      .mockImplementation(async (_sql, _tenant, id) =>
        id === 'source-id' ? source : id === 'target-id' ? target : null,
      );
    vi.spyOn(repo, 'mergeTicketTags').mockResolvedValue(10);
    vi.spyOn(repo, 'update').mockResolvedValue(source);
    const deleteSpy = vi.spyOn(mockSql as unknown as Record<string, unknown>, 'toString')
      .mockReturnValue('');
    void deleteSpy;

    // Provide minimal sql mock for DELETE statement.
    const sqlMock = {
      begin: vi.fn(),
    } as unknown as Sql;
    // Patch sql tagged template literal call.
    (sqlMock as unknown as Record<string, unknown>)['__proto__'] = Function.prototype;
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), {
      begin: vi.fn(),
      unsafe: vi.fn().mockResolvedValue([]),
    }) as unknown as Sql;

    vi.spyOn(repo, 'countTicketsByTag').mockResolvedValue(15);
    vi.spyOn(repo, 'incrementUsageCount').mockResolvedValue(undefined);

    const result = await service.mergeTags(sqlFn, TENANT_ID, 'source-id', 'target-id');
    expect(result.affectedTicketCount).toBe(10);
    expect(repo.mergeTicketTags).toHaveBeenCalledWith(sqlFn, TENANT_ID, 'source-id', 'target-id');
  });

  it('throws TAG_NOT_FOUND when source does not exist', async () => {
    vi.spyOn(repo, 'findById').mockResolvedValue(null);

    await expect(
      service.mergeTags(mockSql, TENANT_ID, 'missing-source', 'target-id'),
    ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
  });
});
