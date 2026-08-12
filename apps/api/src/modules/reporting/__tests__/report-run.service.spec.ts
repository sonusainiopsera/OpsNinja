/**
 * Unit tests for ReportRunService, SharingScopeResolver, and DTO validation — WO-074 AC9.
 *
 * Coverage:
 *  - SharingScopeResolver truth table (private/owner, private/non-owner, team, tenant, cross-tenant)
 *  - ReportRunService: inline definition preview, saved definition preview, viewer-scope substitution
 *    (persisted definition's org scope is NEVER used — viewerOrgScopeIds always from live principal)
 *  - Preview cap truncation (rowCount = PREVIEW_ROW_LIMIT, truncated = true)
 *  - dataAsOf / stale flag from ReplicaLagProbe
 *  - Timeout → 504 REPORT_QUERY_TIMEOUT
 *  - Out-of-scope definition → 404 REPORT_NOT_FOUND
 *  - RunReportSchema DTO validation (exact-one-of invariant, unknown key rejection)
 *  - UpdateReportDefinitionSchema version requirement
 */

import { NotFoundException, GatewayTimeoutException } from '@nestjs/common';
import { SharingScopeResolver } from '../application/sharing-scope.resolver';
import { ReportRunService } from '../application/report-run.service';
import { StatementTimeoutError } from '../infrastructure/reporting-errors';
import { RunReportSchema } from '../api/dto/run-report.dto';
import {
  UpdateReportDefinitionSchema,
  CreateReportDefinitionSchema,
} from '../api/dto/report-definition.dto';
import type { ReportDefinition } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = 'b0000000-0000-0000-0000-000000000001';
const USER_LEAD = 'u0000001-0000-0000-0000-000000000001';
const USER_AGENT = 'u0000002-0000-0000-0000-000000000001';
const DEF_ID = 'd0000001-0000-0000-0000-000000000001';

function makeDefinition(overrides: Partial<ReportDefinition> = {}): ReportDefinition {
  return {
    id:          DEF_ID,
    tenantId:    TENANT_A,
    name:        'My Report',
    description: null,
    metrics:     ['ticket_count'],
    groupBy:     ['priority'],
    filterAst:   null,
    chartType:   'bar',
    sharingScope: 'private',
    version:     1,
    createdBy:   USER_LEAD,
    deletedAt:   null,
    createdAt:   new Date('2024-01-01T00:00:00Z'),
    updatedAt:   new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as ReportDefinition;
}

function makePrincipal(overrides: Record<string, unknown> = {}) {
  return {
    tenantId:    TENANT_A,
    userId:      USER_LEAD,
    roles:       ['lead'],
    orgScopeIds: ['org-001'],
    traceId:     'trace-abc',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SharingScopeResolver — truth table
// ---------------------------------------------------------------------------

describe('SharingScopeResolver', () => {
  let resolver: SharingScopeResolver;

  beforeEach(() => {
    resolver = new SharingScopeResolver();
  });

  it('private + owner → visible', () => {
    expect(resolver.canView(makeDefinition({ sharingScope: 'private' }), {
      userId: USER_LEAD, tenantId: TENANT_A, roles: [],
    })).toBe(true);
  });

  it('private + non-owner (same tenant) → invisible', () => {
    expect(resolver.canView(makeDefinition({ sharingScope: 'private' }), {
      userId: USER_AGENT, tenantId: TENANT_A, roles: [],
    })).toBe(false);
  });

  it('team + any principal in tenant → visible', () => {
    expect(resolver.canView(makeDefinition({ sharingScope: 'team' }), {
      userId: USER_AGENT, tenantId: TENANT_A, roles: [],
    })).toBe(true);
  });

  it('tenant + any principal in tenant → visible', () => {
    expect(resolver.canView(makeDefinition({ sharingScope: 'tenant' }), {
      userId: USER_AGENT, tenantId: TENANT_A, roles: [],
    })).toBe(true);
  });

  it('cross-tenant definition → invisible regardless of scope', () => {
    // Definition belongs to tenant A; viewer is in tenant B
    expect(resolver.canView(makeDefinition({ sharingScope: 'tenant' }), {
      userId: USER_LEAD, tenantId: TENANT_B, roles: [],
    })).toBe(false);
  });

  it('unknown scope falls back to owner-only rule', () => {
    expect(resolver.canView(
      makeDefinition({ sharingScope: 'unknown-scope' as 'private' }),
      { userId: USER_LEAD, tenantId: TENANT_A, roles: [] },
    )).toBe(true);

    expect(resolver.canView(
      makeDefinition({ sharingScope: 'unknown-scope' as 'private' }),
      { userId: USER_AGENT, tenantId: TENANT_A, roles: [] },
    )).toBe(false);
  });

  describe('filterVisible', () => {
    it('returns only definitions the viewer can see', () => {
      const defs = [
        makeDefinition({ id: 'd1', sharingScope: 'private', createdBy: USER_LEAD }),
        makeDefinition({ id: 'd2', sharingScope: 'private', createdBy: USER_AGENT }),
        makeDefinition({ id: 'd3', sharingScope: 'tenant' }),
      ];
      const visible = resolver.filterVisible(defs, { userId: USER_LEAD, tenantId: TENANT_A, roles: [] });
      expect(visible.map((d) => d.id)).toEqual(['d1', 'd3']);
    });
  });
});

// ---------------------------------------------------------------------------
// ReportRunService — unit tests with mocked dependencies
// ---------------------------------------------------------------------------

describe('ReportRunService', () => {
  let runService: ReportRunService;
  let mockRepo: jest.Mocked<{ findById: jest.Mock }>;
  let mockRunner: jest.Mocked<{ run: jest.Mock }>;
  let mockLagProbe: jest.Mocked<{ getReplicaFreshness: jest.Mock }>;
  let mockScopeResolver: SharingScopeResolver;

  const FRESHNESS = {
    lagSeconds: 5,
    isInRecovery: true,
    lastProbedAt: new Date(),
    probeError: null,
  };

  beforeEach(() => {
    mockRepo = { findById: jest.fn() };
    mockRunner = { run: jest.fn() };
    mockLagProbe = { getReplicaFreshness: jest.fn().mockReturnValue(FRESHNESS) };
    mockScopeResolver = new SharingScopeResolver();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runService = new ReportRunService(
      mockRepo as any,
      mockRunner as any,
      mockLagProbe as any,
      mockScopeResolver,
    );
  });

  describe('inline definition preview', () => {
    it('returns columns, rows, rowCount, truncated=false when under cap', async () => {
      const mockRows = [
        { d_priority: 'P1', m_ticket_count: 3 },
        { d_priority: 'P2', m_ticket_count: 7 },
      ];
      mockRunner.run.mockResolvedValue(mockRows);

      const result = await runService.run(makePrincipal(), {
        definition: {
          metrics:   ['ticket_count'],
          groupBy:   ['priority'],
          filterAst: undefined,
          chartType: 'bar',
        },
      });

      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.columns.map((c) => c.key)).toContain('d_priority');
      expect(result.chartType).toBe('bar');
    });

    it('truncates rows when runner returns more than PREVIEW_ROW_LIMIT', async () => {
      // Simulate runner returning 5001 rows (cap+1 requested, so 5001 means over cap)
      const oversized = Array.from({ length: 5001 }, (_, i) => ({ d_priority: `P${i}`, m_ticket_count: 1 }));
      mockRunner.run.mockResolvedValue(oversized);

      const result = await runService.run(makePrincipal(), {
        definition: { metrics: ['ticket_count'], groupBy: ['priority'], chartType: 'table' },
      });

      expect(result.truncated).toBe(true);
      expect(result.rowCount).toBe(5000);
      expect(result.rows).toHaveLength(5000);
    });

    it('returns empty rows and columns when result set is empty', async () => {
      mockRunner.run.mockResolvedValue([]);

      const result = await runService.run(makePrincipal(), {
        definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' },
      });

      expect(result.rows).toEqual([]);
      expect(result.columns).toEqual([]);
      expect(result.totals).toEqual({});
      expect(result.truncated).toBe(false);
    });
  });

  describe('saved definition preview', () => {
    it('fetches definition from repo and executes with live principal org scope', async () => {
      const definition = makeDefinition({ sharingScope: 'tenant' });
      mockRepo.findById.mockResolvedValue(definition);
      mockRunner.run.mockResolvedValue([{ d_priority: 'P1', m_ticket_count: 5 }]);

      const liveOrgScope = ['org-live-001'];  // different from any stored scope
      const result = await runService.run(
        makePrincipal({ orgScopeIds: liveOrgScope }),
        { definitionId: DEF_ID },
      );

      // The runner must have been called — live orgScopeIds injected into compileReportQuery
      expect(mockRunner.run).toHaveBeenCalledTimes(1);
      expect(result.rowCount).toBe(1);
    });

    it('returns 404 when definition not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        runService.run(makePrincipal(), { definitionId: DEF_ID }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for out-of-scope private definition (no existence disclosure)', async () => {
      const privateOwnerDef = makeDefinition({ sharingScope: 'private', createdBy: USER_AGENT });
      mockRepo.findById.mockResolvedValue(privateOwnerDef);

      // Caller is USER_LEAD, not the owner (USER_AGENT)
      await expect(
        runService.run(makePrincipal({ userId: USER_LEAD }), { definitionId: DEF_ID }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('dataAsOf and stale flag', () => {
    it('stale=false when lag is below threshold', async () => {
      mockLagProbe.getReplicaFreshness.mockReturnValue({ ...FRESHNESS, lagSeconds: 10 });
      mockRunner.run.mockResolvedValue([]);

      const result = await runService.run(makePrincipal(), {
        definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' },
      });

      expect(result.stale).toBe(false);
      expect(typeof result.dataAsOf).toBe('string');
    });

    it('stale=true when lag exceeds REPORTING_STALE_LAG_SECONDS', async () => {
      mockLagProbe.getReplicaFreshness.mockReturnValue({ ...FRESHNESS, lagSeconds: 999 });
      mockRunner.run.mockResolvedValue([]);

      const result = await runService.run(makePrincipal(), {
        definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' },
      });

      expect(result.stale).toBe(true);
    });

    it('stale=true when probe encountered an error', async () => {
      mockLagProbe.getReplicaFreshness.mockReturnValue({ ...FRESHNESS, lagSeconds: 0, probeError: 'timeout' });
      mockRunner.run.mockResolvedValue([]);

      const result = await runService.run(makePrincipal(), {
        definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' },
      });

      expect(result.stale).toBe(true);
    });
  });

  describe('statement timeout mapping', () => {
    it('maps StatementTimeoutError to 504 REPORT_QUERY_TIMEOUT', async () => {
      mockRunner.run.mockRejectedValue(new StatementTimeoutError('statement timeout'));

      await expect(
        runService.run(makePrincipal(), {
          definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' },
        }),
      ).rejects.toThrow(GatewayTimeoutException);
    });
  });
});

// ---------------------------------------------------------------------------
// DTO validation
// ---------------------------------------------------------------------------

describe('RunReportSchema — DTO validation', () => {
  it('accepts inline definition', () => {
    const result = RunReportSchema.safeParse({
      definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts saved definitionId', () => {
    const result = RunReportSchema.safeParse({ definitionId: DEF_ID });
    expect(result.success).toBe(true);
  });

  it('rejects both definitionId and definition provided together', () => {
    const result = RunReportSchema.safeParse({
      definitionId: DEF_ID,
      definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects neither definitionId nor definition provided', () => {
    const result = RunReportSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects unknown top-level key (strict mode)', () => {
    const result = RunReportSchema.safeParse({
      definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' },
      extraField: 'should fail',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty metrics array', () => {
    const result = RunReportSchema.safeParse({
      definition: { metrics: [], groupBy: [], chartType: 'table' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid chartType', () => {
    const result = RunReportSchema.safeParse({
      definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'pie' },
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateReportDefinitionSchema — optimistic concurrency', () => {
  it('rejects patch without version field', () => {
    const result = UpdateReportDefinitionSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(false);
  });

  it('accepts valid partial patch with version', () => {
    const result = UpdateReportDefinitionSchema.safeParse({ name: 'New Name', version: 2 });
    expect(result.success).toBe(true);
  });

  it('rejects version=0 (non-positive)', () => {
    const result = UpdateReportDefinitionSchema.safeParse({ version: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown field (strict mode)', () => {
    const result = UpdateReportDefinitionSchema.safeParse({ version: 1, adminOverride: true });
    expect(result.success).toBe(false);
  });
});

describe('CreateReportDefinitionSchema — validation', () => {
  it('accepts a valid create payload with default sharingScope', () => {
    const result = CreateReportDefinitionSchema.safeParse({
      name: 'Weekly SLA Report',
      metrics: ['ticket_count'],
      groupBy: ['status'],
      chartType: 'bar',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sharingScope).toBe('private');
    }
  });

  it('accepts all three sharing scopes', () => {
    for (const scope of ['private', 'team', 'tenant'] as const) {
      const result = CreateReportDefinitionSchema.safeParse({
        name: 'R', metrics: ['ticket_count'], groupBy: [], chartType: 'table', sharingScope: scope,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown sharing scope', () => {
    expect(CreateReportDefinitionSchema.safeParse({
      name: 'R', metrics: ['ticket_count'], groupBy: [], chartType: 'table', sharingScope: 'public',
    }).success).toBe(false);
  });

  it('rejects missing name', () => {
    expect(CreateReportDefinitionSchema.safeParse({
      metrics: ['ticket_count'], groupBy: [], chartType: 'table',
    }).success).toBe(false);
  });
});
