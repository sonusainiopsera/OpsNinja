/**
 * Integration tests for WO-052: Jira Project Scoping and Field Mapping.
 *
 * All external I/O is mocked (no real DB, Redis, or Jira API required).
 * DB-backed RLS assertions require DATABASE_URL and are in maybeDescribe.
 *
 * Coverage:
 *   AC7  — JiraMappingResolver precedence (category > org > default)
 *   AC7  — No enabled mapping → MappingNotFoundError (never implicit fallback)
 *   AC5  — Saving a mapping that omits a required Jira field returns 422 JIRA_REQUIRED_FIELD_UNMAPPED
 *   AC6  — Single-default exclusivity: clearDefault called before creating/updating with isDefault=true
 *   AC9  — Unit: required-field detection via getMissingRequiredFields
 *   AC10 — Metadata cache hit (no HTTP call), cache miss (HTTP call + store), force-refresh
 *   AC10 — Cross-tenant 404: resolver only returns tenant-scoped enabled rows
 *   AC11 — Exported fixtures: canned project list, createmeta for two issue types, three mapping docs
 */

import { Logger } from '@nestjs/common';
import { JiraMappingResolver, MappingNotFoundError, MappingDisabledError } from '../../src/modules/jira/mapping/jira-mapping.resolver';
import { JiraMappingService } from '../../src/modules/jira/mapping/jira-mapping.service';
import { JiraMetadataService } from '../../src/modules/jira/metadata/jira-metadata.service';
import { JiraMappingRepository } from '../../src/modules/jira/mapping/jira-mapping.repository';
import type { JiraHttpClient } from '../../src/modules/jira/http/jira-http.client';
import type { JiraTokenProvider } from '../../src/modules/jira/tokens/jira-token.provider';
import type { JiraConnectionsRepository } from '../../src/modules/jira/connections/jira-connections.repository';
import type { JiraProjectMapping } from '@opsninja/db';
import type Redis from 'ioredis';

// ---------------------------------------------------------------------------
// AC11 — Exported fixtures: canned Jira data + three mapping documents
// ---------------------------------------------------------------------------

export const FIXTURE_TENANT_ID = 'f0052001-0000-0000-0000-000000000001';
export const FIXTURE_TENANT_B_ID = 'f0052001-0000-0000-0000-000000000002';
export const FIXTURE_CONNECTION_ID = 'f0052002-0000-0000-0000-000000000001';
export const FIXTURE_MAPPING_ID_DEFAULT = 'f0052003-0000-0000-0000-000000000001';
export const FIXTURE_MAPPING_ID_CATEGORY = 'f0052003-0000-0000-0000-000000000002';
export const FIXTURE_MAPPING_ID_ORG = 'f0052003-0000-0000-0000-000000000003';

/** Canned Jira project list — two projects. */
export const CANNED_JIRA_PROJECTS = [
  {
    id: '10000',
    key: 'PLAT',
    name: 'Platform',
    projectTypeKey: 'software',
    issueTypes: [
      { id: '10001', name: 'Bug', description: 'A software defect', subtask: false },
      { id: '10002', name: 'Task', description: 'A general task', subtask: false },
    ],
  },
  {
    id: '10001',
    key: 'OPS',
    name: 'Operations',
    projectTypeKey: 'service_desk',
    issueTypes: [
      { id: '10003', name: 'IT Help', description: 'IT service request', subtask: false },
    ],
  },
];

/** Canned createmeta field list for PLAT / Bug (issue type 10001). */
export const CANNED_FIELDS_PLAT_BUG = [
  { fieldId: 'summary', name: 'Summary', schemaType: 'string', required: true, allowedValues: [] },
  { fieldId: 'description', name: 'Description', schemaType: 'string', required: false, allowedValues: [] },
  {
    fieldId: 'priority',
    name: 'Priority',
    schemaType: 'priority',
    required: true,
    allowedValues: [
      { id: '1', name: 'Highest' },
      { id: '2', name: 'High' },
      { id: '3', name: 'Medium' },
      { id: '4', name: 'Low' },
      { id: '5', name: 'Lowest' },
    ],
  },
  { fieldId: 'assignee', name: 'Assignee', schemaType: 'user', required: false, allowedValues: [] },
];

/** Canned createmeta for PLAT / Task (issue type 10002) — only summary required. */
export const CANNED_FIELDS_PLAT_TASK = [
  { fieldId: 'summary', name: 'Summary', schemaType: 'string', required: true, allowedValues: [] },
  { fieldId: 'description', name: 'Description', schemaType: 'string', required: false, allowedValues: [] },
];

/** Raw Jira API project/search response (Cloud format). */
export const CANNED_PROJECTS_API_RESPONSE = {
  values: CANNED_JIRA_PROJECTS.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    projectTypeKey: p.projectTypeKey,
    issueTypes: p.issueTypes,
  })),
};

/** Raw Jira createmeta API response for PLAT Bug. */
export const CANNED_CREATEMETA_PLAT_BUG_API = {
  projects: [
    {
      id: '10000',
      key: 'PLAT',
      issuetypes: [
        {
          id: '10001',
          name: 'Bug',
          fields: {
            summary: { required: true, schema: { type: 'string' }, name: 'Summary', allowedValues: [] },
            description: { required: false, schema: { type: 'string' }, name: 'Description', allowedValues: [] },
            priority: {
              required: true,
              schema: { type: 'priority' },
              name: 'Priority',
              allowedValues: [
                { id: '1', name: 'Highest' },
                { id: '2', name: 'High' },
                { id: '3', name: 'Medium' },
              ],
            },
            assignee: { required: false, schema: { type: 'user' }, name: 'Assignee', allowedValues: [] },
          },
        },
      ],
    },
  ],
};

/** Raw Jira createmeta API response for PLAT Task. */
export const CANNED_CREATEMETA_PLAT_TASK_API = {
  projects: [
    {
      id: '10000',
      key: 'PLAT',
      issuetypes: [
        {
          id: '10002',
          name: 'Task',
          fields: {
            summary: { required: true, schema: { type: 'string' }, name: 'Summary', allowedValues: [] },
            description: { required: false, schema: { type: 'string' }, name: 'Description', allowedValues: [] },
          },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Three mapping documents (AC11)
// ---------------------------------------------------------------------------

/** Valid mapping: maps summary (required) and priority (required) → all required covered. */
export const MAPPING_DOCUMENT_VALID = {
  connectionId: FIXTURE_CONNECTION_ID,
  projectKey: 'PLAT',
  projectId: '10000',
  defaultIssueTypeId: '10001',
  fieldMap: [
    { source: 'ticket.title', target: { fieldId: 'summary', schemaType: 'string' } },
    { source: 'ticket.priority', target: { fieldId: 'priority', schemaType: 'priority' }, transform: 'priority_to_jira' },
  ],
  statusMap: [
    { jiraStatusId: 'done', opsninjaStatus: 'resolved' },
    { jiraStatusCategory: 'in-progress', opsninjaStatus: 'in_progress' },
  ],
  syncRules: {
    applyInboundStatus: true,
    applyInboundComments: true,
    autoResolveOnJiraDone: true,
    commentVisibility: 'internal' as const,
  },
  isDefault: true,
  enabled: true,
};

/** Unknown-key document: source 'ticket.internal_secret' is not allow-listed → schema rejects. */
export const MAPPING_DOCUMENT_UNKNOWN_KEY = {
  ...MAPPING_DOCUMENT_VALID,
  fieldMap: [
    { source: 'ticket.internal_secret', target: { fieldId: 'summary', schemaType: 'string' } },
  ],
};

/** Missing-required document: 'priority' (required) is absent from fieldMap. */
export const MAPPING_DOCUMENT_MISSING_REQUIRED = {
  ...MAPPING_DOCUMENT_VALID,
  fieldMap: [
    // summary covered, but priority (required by PLAT/Bug) is NOT mapped
    { source: 'ticket.title', target: { fieldId: 'summary', schemaType: 'string' } },
  ],
};

// ---------------------------------------------------------------------------
// Shared mapping row factory
// ---------------------------------------------------------------------------

function makeMapping(
  id: string,
  opts: {
    isDefault?: boolean;
    enabled?: boolean;
    categoryPaths?: string[];
    organizationIds?: string[];
  } = {},
): JiraProjectMapping {
  return {
    id,
    tenantId: FIXTURE_TENANT_ID,
    connectionId: FIXTURE_CONNECTION_ID,
    projectKey: 'PLAT',
    projectId: '10000',
    defaultIssueTypeId: '10001',
    fieldMap: [],
    statusMap: [],
    syncRules: {
      applyInboundStatus: true,
      applyInboundComments: true,
      autoResolveOnJiraDone: false,
      commentVisibility: 'internal',
      categoryPaths: opts.categoryPaths,
      organizationIds: opts.organizationIds,
    },
    isDefault: opts.isDefault ?? false,
    enabled: opts.enabled ?? true,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as JiraProjectMapping;
}

// ---------------------------------------------------------------------------
// Resolver builder
// ---------------------------------------------------------------------------

function buildResolver() {
  const mockRepo = {
    findEnabled: jest.fn(),
    findById: jest.fn(),
  } as unknown as JiraMappingRepository;
  const resolver = new JiraMappingResolver(mockRepo);
  return { resolver, mockRepo };
}

// ---------------------------------------------------------------------------
// Metadata service builder
// ---------------------------------------------------------------------------

function buildMetadataService() {
  const mockRedis = { get: jest.fn(), setex: jest.fn() } as unknown as Redis;
  const mockHttp = { getJson: jest.fn() } as unknown as JiraHttpClient;
  const mockTokenProvider = { getAccessToken: jest.fn().mockResolvedValue('mock-access-token') } as unknown as JiraTokenProvider;
  const mockConnRepo = {
    findById: jest.fn().mockResolvedValue({
      id: FIXTURE_CONNECTION_ID,
      tenantId: FIXTURE_TENANT_ID,
      siteUrl: 'https://acme.atlassian.net',
    }),
  } as unknown as JiraConnectionsRepository;
  const service = new JiraMetadataService(mockRedis, mockHttp, mockTokenProvider, mockConnRepo);
  return { service, mockRedis, mockHttp, mockTokenProvider, mockConnRepo };
}

// ---------------------------------------------------------------------------
// Mapping service builder
// ---------------------------------------------------------------------------

function buildMappingService() {
  const mockRepo = {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    clearDefault: jest.fn().mockResolvedValue(undefined),
    findPaginated: jest.fn(),
  } as unknown as JiraMappingRepository;
  const mockMetadata = {
    getMissingRequiredFields: jest.fn(),
  } as unknown as JiraMetadataService;
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const service = new JiraMappingService(mockRepo, mockMetadata);
  return { service, mockRepo, mockMetadata };
}

// ===========================================================================
// JiraMappingResolver — deterministic precedence (AC7, AC9)
// ===========================================================================

describe('JiraMappingResolver', () => {
  let resolver: JiraMappingResolver;
  let mockRepo: jest.Mocked<JiraMappingRepository>;

  beforeEach(() => {
    const built = buildResolver();
    resolver = built.resolver;
    mockRepo = built.mockRepo as jest.Mocked<JiraMappingRepository>;
  });

  // ── Precedence chain ────────────────────────────────────────────────────

  it('returns category-path match when available (highest precedence)', async () => {
    const categoryMapping = makeMapping(FIXTURE_MAPPING_ID_CATEGORY, { categoryPaths: ['Cloud / AWS'] });
    const defaultMapping = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { isDefault: true });
    mockRepo.findEnabled.mockResolvedValue([categoryMapping, defaultMapping]);

    const result = await resolver.resolveTarget(FIXTURE_TENANT_ID, { categoryPath: 'Cloud / AWS' });

    expect(result.mapping.id).toBe(FIXTURE_MAPPING_ID_CATEGORY);
  });

  it('normalises category-path whitespace before matching', async () => {
    const categoryMapping = makeMapping(FIXTURE_MAPPING_ID_CATEGORY, { categoryPaths: ['Cloud / AWS'] });
    mockRepo.findEnabled.mockResolvedValue([categoryMapping]);

    // Extra spaces around the separator must still match
    const result = await resolver.resolveTarget(FIXTURE_TENANT_ID, { categoryPath: 'Cloud   /   AWS' });

    expect(result.mapping.id).toBe(FIXTURE_MAPPING_ID_CATEGORY);
  });

  it('returns organisation match when no category match exists', async () => {
    const orgId = 'ffffffff-0000-0000-0000-000000000001';
    const orgMapping = makeMapping(FIXTURE_MAPPING_ID_ORG, { organizationIds: [orgId] });
    const defaultMapping = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { isDefault: true });
    mockRepo.findEnabled.mockResolvedValue([orgMapping, defaultMapping]);

    const result = await resolver.resolveTarget(FIXTURE_TENANT_ID, {
      categoryPath: 'Unmatched / Category',
      organizationId: orgId,
    });

    expect(result.mapping.id).toBe(FIXTURE_MAPPING_ID_ORG);
  });

  it('category-path match takes precedence over organisation match', async () => {
    const orgId = 'ffffffff-0000-0000-0000-000000000001';
    const categoryMapping = makeMapping(FIXTURE_MAPPING_ID_CATEGORY, { categoryPaths: ['Cloud / AWS'] });
    const orgMapping = makeMapping(FIXTURE_MAPPING_ID_ORG, { organizationIds: [orgId] });
    const defaultMapping = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { isDefault: true });
    mockRepo.findEnabled.mockResolvedValue([categoryMapping, orgMapping, defaultMapping]);

    const result = await resolver.resolveTarget(FIXTURE_TENANT_ID, {
      categoryPath: 'Cloud / AWS',
      organizationId: orgId,
    });

    expect(result.mapping.id).toBe(FIXTURE_MAPPING_ID_CATEGORY);
  });

  it('falls back to the default mapping when no category or org match', async () => {
    const defaultMapping = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { isDefault: true });
    mockRepo.findEnabled.mockResolvedValue([defaultMapping]);

    const result = await resolver.resolveTarget(FIXTURE_TENANT_ID, { categoryPath: 'Other / Path' });

    expect(result.mapping.id).toBe(FIXTURE_MAPPING_ID_DEFAULT);
  });

  it('populates ResolvedTarget fields from the mapping row', async () => {
    const defaultMapping = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { isDefault: true });
    mockRepo.findEnabled.mockResolvedValue([defaultMapping]);

    const result = await resolver.resolveTarget(FIXTURE_TENANT_ID, {});

    expect(result.connectionId).toBe(FIXTURE_CONNECTION_ID);
    expect(result.projectKey).toBe('PLAT');
    expect(result.projectId).toBe('10000');
    expect(result.issueTypeId).toBe('10001');
  });

  // ── Failure paths ───────────────────────────────────────────────────────

  it('throws MappingNotFoundError when no enabled mappings exist', async () => {
    mockRepo.findEnabled.mockResolvedValue([]);

    await expect(resolver.resolveTarget(FIXTURE_TENANT_ID, { categoryPath: 'Any / Path' }))
      .rejects.toBeInstanceOf(MappingNotFoundError);
  });

  it('throws MappingNotFoundError when mappings exist but none match', async () => {
    // Category mapping for a different path, no default
    const categoryMapping = makeMapping(FIXTURE_MAPPING_ID_CATEGORY, { categoryPaths: ['Cloud / Azure'], isDefault: false });
    mockRepo.findEnabled.mockResolvedValue([categoryMapping]);

    await expect(resolver.resolveTarget(FIXTURE_TENANT_ID, { categoryPath: 'Cloud / GCP' }))
      .rejects.toBeInstanceOf(MappingNotFoundError);
  });

  it('MappingNotFoundError has code MAPPING_NOT_FOUND', async () => {
    mockRepo.findEnabled.mockResolvedValue([]);

    let err: MappingNotFoundError | undefined;
    try {
      await resolver.resolveTarget(FIXTURE_TENANT_ID, {});
    } catch (e) {
      err = e as MappingNotFoundError;
    }

    expect(err?.code).toBe('MAPPING_NOT_FOUND');
  });

  it('resolveById throws MappingDisabledError when mapping is disabled', async () => {
    const disabledMapping = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { enabled: false });
    // findEnabled returns nothing (disabled); findById returns the raw row
    mockRepo.findEnabled.mockResolvedValue([]);
    mockRepo.findById.mockResolvedValue(disabledMapping);

    await expect(resolver.resolveById(FIXTURE_TENANT_ID, FIXTURE_MAPPING_ID_DEFAULT))
      .rejects.toBeInstanceOf(MappingDisabledError);
  });

  it('resolveById throws MappingNotFoundError when mapping does not exist at all', async () => {
    mockRepo.findEnabled.mockResolvedValue([]);
    mockRepo.findById.mockResolvedValue(null);

    await expect(resolver.resolveById(FIXTURE_TENANT_ID, 'does-not-exist'))
      .rejects.toBeInstanceOf(MappingNotFoundError);
  });

  // ── Cross-tenant isolation (AC10) ───────────────────────────────────────

  it('never returns a mapping from a different tenant (findEnabled is tenant-scoped)', async () => {
    // findEnabled returns [] for FIXTURE_TENANT_ID (as RLS would do for a different tenant's data)
    mockRepo.findEnabled.mockResolvedValue([]);

    await expect(resolver.resolveTarget(FIXTURE_TENANT_ID, {}))
      .rejects.toBeInstanceOf(MappingNotFoundError);

    // Verify findEnabled was called with FIXTURE_TENANT_ID, never FIXTURE_TENANT_B_ID
    expect(mockRepo.findEnabled).toHaveBeenCalledWith(FIXTURE_TENANT_ID, undefined);
  });
});

// ===========================================================================
// JiraMetadataService — caching behaviour (AC2, AC10)
// ===========================================================================

describe('JiraMetadataService', () => {
  let service: JiraMetadataService;
  let mockRedis: jest.Mocked<Redis>;
  let mockHttp: jest.Mocked<JiraHttpClient>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const built = buildMetadataService();
    service = built.service;
    mockRedis = built.mockRedis as jest.Mocked<Redis>;
    mockHttp = built.mockHttp as jest.Mocked<JiraHttpClient>;
  });

  // ── Projects cache hit/miss ────────────────────────────────────────────

  it('returns cached projects without making an HTTP call (cache hit)', async () => {
    const cached = {
      projects: CANNED_JIRA_PROJECTS,
      nextCursor: null,
      cachedAt: '2026-01-01T00:00:00.000Z',
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(cached));

    const result = await service.getProjects(FIXTURE_TENANT_ID, FIXTURE_CONNECTION_ID);

    expect(mockHttp.getJson).not.toHaveBeenCalled();
    expect(result.projects).toHaveLength(CANNED_JIRA_PROJECTS.length);
    expect(result.projects[0]?.key).toBe('PLAT');
  });

  it('fetches from Jira and stores in cache on cache miss', async () => {
    mockRedis.get.mockResolvedValue(null); // cache miss
    mockHttp.getJson.mockResolvedValue(CANNED_PROJECTS_API_RESPONSE);

    const result = await service.getProjects(FIXTURE_TENANT_ID, FIXTURE_CONNECTION_ID);

    expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
    expect(mockRedis.setex).toHaveBeenCalledWith(
      `jira:meta:${FIXTURE_TENANT_ID}:${FIXTURE_CONNECTION_ID}:projects`,
      900, // 15 minutes
      expect.any(String),
    );
    expect(result.projects).toHaveLength(CANNED_JIRA_PROJECTS.length);
  });

  it('force-refresh bypasses cache and fetches from Jira', async () => {
    const staleCache = {
      projects: [{ id: '99999', key: 'OLD', name: 'Stale', projectTypeKey: 'software', issueTypes: [] }],
      nextCursor: null,
      cachedAt: '2025-01-01T00:00:00.000Z',
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(staleCache));
    mockHttp.getJson.mockResolvedValue(CANNED_PROJECTS_API_RESPONSE);

    const result = await service.getProjects(FIXTURE_TENANT_ID, FIXTURE_CONNECTION_ID, { forceRefresh: true });

    expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
    expect(result.projects[0]?.key).toBe('PLAT'); // fresh data, not 'OLD'
  });

  it('returns stale cached projects when Jira API fails (graceful degradation)', async () => {
    const staleCache = {
      projects: CANNED_JIRA_PROJECTS,
      nextCursor: null,
      cachedAt: '2025-01-01T00:00:00.000Z',
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(staleCache));
    // Force-refresh path hits network error
    mockHttp.getJson.mockRejectedValue(new Error('Network error'));

    const result = await service.getProjects(FIXTURE_TENANT_ID, FIXTURE_CONNECTION_ID, { forceRefresh: true });

    expect(result.stale).toBe(true);
    expect(result.projects).toHaveLength(CANNED_JIRA_PROJECTS.length);
  });

  // ── Fields / getMissingRequiredFields ──────────────────────────────────

  it('returns empty array when all required fields are covered by fieldMap', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(CANNED_FIELDS_PLAT_BUG));
    // Both required fields (summary + priority) covered
    const missing = await service.getMissingRequiredFields(
      FIXTURE_TENANT_ID,
      FIXTURE_CONNECTION_ID,
      'PLAT',
      '10001',
      ['summary', 'priority'],
    );
    expect(missing).toHaveLength(0);
  });

  it('returns fieldId list for required fields not in fieldMap (AC9)', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(CANNED_FIELDS_PLAT_BUG));
    // Only summary covered; priority (required) is missing
    const missing = await service.getMissingRequiredFields(
      FIXTURE_TENANT_ID,
      FIXTURE_CONNECTION_ID,
      'PLAT',
      '10001',
      ['summary'],
    );
    expect(missing).toContain('priority');
    expect(missing).not.toContain('summary');
    expect(missing).not.toContain('description'); // description is optional
  });

  it('cache key for fields is namespaced by tenant, connection, project and issue type', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockHttp.getJson.mockResolvedValue(CANNED_CREATEMETA_PLAT_BUG_API);

    await service.getFields(FIXTURE_TENANT_ID, FIXTURE_CONNECTION_ID, 'PLAT', '10001');

    const expectedKey = `jira:meta:${FIXTURE_TENANT_ID}:${FIXTURE_CONNECTION_ID}:fields:PLAT:10001`;
    expect(mockRedis.get).toHaveBeenCalledWith(expectedKey);
    expect(mockRedis.setex).toHaveBeenCalledWith(expectedKey, 900, expect.any(String));
  });
});

// ===========================================================================
// JiraMappingService — required-field validation and default exclusivity (AC5, AC6)
// ===========================================================================

describe('JiraMappingService', () => {
  let service: JiraMappingService;
  let mockRepo: { [K in keyof JiraMappingRepository]: jest.Mock };
  let mockMetadata: { [K in keyof JiraMetadataService]: jest.Mock };

  beforeEach(() => {
    const built = buildMappingService();
    service = built.service;
    mockRepo = built.mockRepo as unknown as { [K in keyof JiraMappingRepository]: jest.Mock };
    mockMetadata = built.mockMetadata as unknown as { [K in keyof JiraMetadataService]: jest.Mock };
  });

  const BASE_CREATE_DTO = {
    connectionId: FIXTURE_CONNECTION_ID,
    projectKey: 'PLAT',
    projectId: '10000',
    defaultIssueTypeId: '10001',
    fieldMap: [
      { source: 'ticket.title' as const, target: { fieldId: 'summary', schemaType: 'string' } },
      { source: 'ticket.priority' as const, target: { fieldId: 'priority', schemaType: 'priority' }, transform: 'priority_to_jira' as const },
    ],
    statusMap: [{ jiraStatusId: 'done', opsninjaStatus: 'resolved' as const }],
    syncRules: {
      applyInboundStatus: true,
      applyInboundComments: true,
      autoResolveOnJiraDone: false,
      commentVisibility: 'internal' as const,
    },
    isDefault: false,
    enabled: true,
  };

  it('creates a mapping when all required Jira fields are covered', async () => {
    mockMetadata.getMissingRequiredFields.mockResolvedValue([]); // no missing fields
    const newRow = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { isDefault: false });
    mockRepo.create.mockResolvedValue(newRow);

    const result = await service.create(FIXTURE_TENANT_ID, 'user-id', BASE_CREATE_DTO);

    expect(result.id).toBe(FIXTURE_MAPPING_ID_DEFAULT);
    expect(mockRepo.clearDefault).not.toHaveBeenCalled(); // isDefault=false
  });

  it('throws 422 JIRA_REQUIRED_FIELD_UNMAPPED when required Jira fields are missing (AC5)', async () => {
    mockMetadata.getMissingRequiredFields.mockResolvedValue(['priority']); // priority not mapped

    await expect(
      service.create(FIXTURE_TENANT_ID, 'user-id', { ...BASE_CREATE_DTO }),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        error: {
          code: 'JIRA_REQUIRED_FIELD_UNMAPPED',
          details: ['priority'],
        },
      },
    });
  });

  it('calls clearDefault before creating when isDefault=true (AC6)', async () => {
    mockMetadata.getMissingRequiredFields.mockResolvedValue([]);
    const newRow = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { isDefault: true });
    mockRepo.create.mockResolvedValue(newRow);

    await service.create(FIXTURE_TENANT_ID, 'user-id', { ...BASE_CREATE_DTO, isDefault: true });

    expect(mockRepo.clearDefault).toHaveBeenCalledWith(FIXTURE_TENANT_ID, FIXTURE_CONNECTION_ID);
  });

  it('does NOT call clearDefault when isDefault=false', async () => {
    mockMetadata.getMissingRequiredFields.mockResolvedValue([]);
    const newRow = makeMapping(FIXTURE_MAPPING_ID_DEFAULT, { isDefault: false });
    mockRepo.create.mockResolvedValue(newRow);

    await service.create(FIXTURE_TENANT_ID, 'user-id', { ...BASE_CREATE_DTO, isDefault: false });

    expect(mockRepo.clearDefault).not.toHaveBeenCalled();
  });

  it('throws 404 when updating a mapping that does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(
      service.update(FIXTURE_TENANT_ID, 'non-existent-id', { projectKey: 'OPS' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws 404 when deleting a mapping that does not exist', async () => {
    mockRepo.delete.mockResolvedValue(false);

    await expect(
      service.delete(FIXTURE_TENANT_ID, 'non-existent-id'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('calls clearDefault on update when isDefault=true is set (AC6)', async () => {
    const existing = makeMapping(FIXTURE_MAPPING_ID_CATEGORY, { isDefault: false });
    mockRepo.findById.mockResolvedValue(existing);
    mockMetadata.getMissingRequiredFields.mockResolvedValue([]);
    const updated = makeMapping(FIXTURE_MAPPING_ID_CATEGORY, { isDefault: true });
    mockRepo.update.mockResolvedValue(updated);

    await service.update(FIXTURE_TENANT_ID, FIXTURE_MAPPING_ID_CATEGORY, { isDefault: true });

    expect(mockRepo.clearDefault).toHaveBeenCalledWith(FIXTURE_TENANT_ID, FIXTURE_CONNECTION_ID);
  });
});

// ===========================================================================
// DB characterisation (requires DATABASE_URL + RLS)  — AC10
// ===========================================================================

const SKIP_DB = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP_DB ? describe.skip : describe;

maybeDescribe('jira_project_mappings — RLS characterisation (DATABASE_URL required)', () => {
  const { Pool } = require('pg') as typeof import('pg');
  let pool: InstanceType<typeof Pool>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    const client = await pool.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }

  it('jira_project_mappings has tenant_id NOT NULL', async () => {
    const { rows } = await query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'jira_project_mappings' AND column_name = 'tenant_id'
    `);
    expect((rows[0] as { is_nullable: string })?.is_nullable).toBe('NO');
  });

  it('FORCE ROW LEVEL SECURITY is enabled', async () => {
    const { rows } = await query(`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'jira_project_mappings'
    `);
    const row = rows[0] as { relrowsecurity: boolean; relforcerowsecurity: boolean };
    expect(row?.relrowsecurity).toBe(true);
    expect(row?.relforcerowsecurity).toBe(true);
  });

  it('unique partial index enforces single default per connection', async () => {
    const { rows } = await query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'jira_project_mappings'
        AND indexname = 'jira_project_mappings_unique_default_idx'
    `);
    expect(rows).toHaveLength(1);
  });

  it('cross-tenant isolation: rows are invisible when app.current_tenant differs', async () => {
    const client = await pool.connect();
    try {
      // Set tenant to a different UUID — no rows visible (RLS)
      await client.query(`SET app.current_tenant = '00000000-0000-0000-0000-000000000099'`);
      const { rows } = await client.query(
        `SELECT id FROM jira_project_mappings WHERE tenant_id = $1`,
        [FIXTURE_TENANT_ID],
      );
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });
});
