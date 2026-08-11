/**
 * 12-month two-tenant reporting fixture — WO-073.
 *
 * Provides deterministic seed data for aggregate reporting tests.
 * Two tenants, four priorities, nested categories, SLA outcomes,
 * and AI affected-area tags — structured so expected aggregate
 * values are predictable without runtime computation.
 *
 * Usage:
 *   const seed = buildReportingTwelveMonthSeed(TENANT_A_ID, TENANT_B_ID);
 *   // seed.ticketRows contains raw insert-ready rows for the tickets table
 *   // seed.exportJobRows contains export_jobs rows
 *   // seed.reportDefRows contains report_definitions rows
 *
 * The fixture spans 2025-01-01 to 2025-12-31 (12 months, one ticket per
 * (month × priority × category) combination for TENANT_A, and a smaller
 * set for TENANT_B to verify cross-tenant isolation).
 */

// ---------------------------------------------------------------------------
// Fixed identifiers (UUIDs are deterministic for reproducibility)
// ---------------------------------------------------------------------------

export const TENANT_A_ID = '10000000-0000-0000-0000-000000000001';
export const TENANT_B_ID = '10000000-0000-0000-0000-000000000002';

export const ORG_A1_ID = '20000000-0000-0000-0000-000000000001';
export const ORG_A2_ID = '20000000-0000-0000-0000-000000000002';
export const ORG_B1_ID = '20000000-0000-0000-0000-000000000003';

export const AGENT_A1_ID = '30000000-0000-0000-0000-000000000001';
export const AGENT_B1_ID = '30000000-0000-0000-0000-000000000002';

export const REPORT_DEF_A1_ID = '40000000-0000-0000-0000-000000000001';
export const EXPORT_JOB_A1_ID = '50000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Seed shape types
// ---------------------------------------------------------------------------

export interface SeedTicket {
  id: string;
  tenantId: string;
  organizationId: string;
  subject: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  categoryPath: string;
  subCategory: string;
  slaState: string;
  aiAffectedAreaTag: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionMinutes: number | null;
  csatScore: number | null;
}

export interface SeedReportDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  metrics: string[];
  groupBy: string[];
  filterAst: unknown;
  chartType: string;
  sharingScope: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: null;
}

export interface SeedExportJob {
  id: string;
  tenantId: string;
  reportDefinitionId: string;
  requestedBy: string;
  format: string;
  status: string;
  s3Key: string | null;
  rowCount: number | null;
  byteSize: number | null;
  errorCode: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ReportingTwelveMonthSeed {
  ticketRows: SeedTicket[];
  reportDefRows: SeedReportDefinition[];
  exportJobRows: SeedExportJob[];
  /** Expected aggregate values for TENANT_A for deterministic assertions */
  expectedAggregates: {
    ticketCountTotal: number;
    ticketCountByPriority: Record<string, number>;
    slaBreachCount: number;
    ticketCountTenantB: number;
  };
}

// ---------------------------------------------------------------------------
// Deterministic UUID generator (no randomness — reproducible across runs)
// ---------------------------------------------------------------------------

let _seqCounter = 0;
function seqUuid(prefix: string): string {
  _seqCounter++;
  const hex = _seqCounter.toString(16).padStart(12, '0');
  return prefix + '-0000-0000-0000-' + hex;
}

// ---------------------------------------------------------------------------
// Seed builder
// ---------------------------------------------------------------------------

export function buildReportingTwelveMonthSeed(
  tenantAId = TENANT_A_ID,
  tenantBId = TENANT_B_ID,
): ReportingTwelveMonthSeed {
  _seqCounter = 0;
  const ticketRows: SeedTicket[] = [];

  const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
  const CATEGORIES: Array<{ path: string; sub: string }> = [
    { path: 'infrastructure', sub: 'networking' },
    { path: 'infrastructure', sub: 'compute' },
    { path: 'application', sub: 'auth' },
  ];
  const AI_TAGS = ['network', 'compute', 'auth', null] as const;
  const CSAT_SCORES = [4, 5, 3, null] as const;

  // TENANT_A: 12 months × 4 priorities × 3 categories = 144 tickets across 2 orgs
  for (let month = 0; month < 12; month++) {
    for (const priority of PRIORITIES) {
      for (const cat of CATEGORIES) {
        const isP1P2 = priority === 'P1' || priority === 'P2';
        const createdAt = new Date(2025, month, 15, 10, 0, 0);
        const resolutionMinutes = isP1P2 ? 45 : 120;
        const resolvedAt = new Date(createdAt.getTime() + resolutionMinutes * 60 * 1000);
        // P1 in month 0-5 are breached, others are ok
        const slaState = priority === 'P1' && month < 6 ? 'breached' : 'ok';
        const orgId = month % 2 === 0 ? ORG_A1_ID : ORG_A2_ID;
        const aiTag = AI_TAGS[(month + PRIORITIES.indexOf(priority)) % AI_TAGS.length];
        const csatScore = CSAT_SCORES[PRIORITIES.indexOf(priority)];

        ticketRows.push({
          id: seqUuid('aaaa0000'),
          tenantId: tenantAId,
          organizationId: orgId,
          subject: 'Tenant A ticket ' + month + '-' + priority + '-' + cat.sub,
          status: 'resolved',
          priority,
          assigneeId: AGENT_A1_ID,
          categoryPath: cat.path,
          subCategory: cat.sub,
          slaState,
          aiAffectedAreaTag: aiTag ?? null,
          createdAt,
          resolvedAt,
          resolutionMinutes,
          csatScore: csatScore ?? null,
        });
      }
    }
  }

  // TENANT_B: 5 tickets in month 0 only — verifies cross-tenant isolation
  for (let i = 0; i < 5; i++) {
    const createdAt = new Date(2025, 0, 5 + i, 10, 0, 0);
    ticketRows.push({
      id: seqUuid('bbbb0000'),
      tenantId: tenantBId,
      organizationId: ORG_B1_ID,
      subject: 'Tenant B ticket ' + i,
      status: 'open',
      priority: 'P3',
      assigneeId: AGENT_B1_ID,
      categoryPath: 'application',
      subCategory: 'billing',
      slaState: 'ok',
      aiAffectedAreaTag: null,
      createdAt,
      resolvedAt: null,
      resolutionMinutes: null,
      csatScore: null,
    });
  }

  // Report definition for TENANT_A
  const reportDefRows: SeedReportDefinition[] = [
    {
      id: REPORT_DEF_A1_ID,
      tenantId: tenantAId,
      name: '12-Month Ticket Volume by Priority',
      description: 'Monthly ticket counts grouped by priority for deterministic test assertions',
      metrics: ['ticket_count', 'sla_breach_count'],
      groupBy: ['priority', 'created_date'],
      filterAst: {
        type: 'condition',
        field: 'created_date',
        operator: 'between',
        value: ['2025-01-01', '2025-12-31'],
      },
      chartType: 'bar',
      sharingScope: 'shared',
      createdBy: AGENT_A1_ID,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      deletedAt: null,
    },
  ];

  // Export job for TENANT_A
  const exportJobRows: SeedExportJob[] = [
    {
      id: EXPORT_JOB_A1_ID,
      tenantId: tenantAId,
      reportDefinitionId: REPORT_DEF_A1_ID,
      requestedBy: AGENT_A1_ID,
      format: 'csv',
      status: 'complete',
      s3Key: 'exports/tenant-a/report-a1-2025.csv',
      rowCount: 48,
      byteSize: 4096,
      errorCode: null,
      expiresAt: new Date('2025-03-01T00:00:00Z'),
      createdAt: new Date('2025-01-15T10:00:00Z'),
      completedAt: new Date('2025-01-15T10:01:30Z'),
    },
  ];

  // Compute expected aggregates for assertions
  const tenantATickets = ticketRows.filter((t) => t.tenantId === tenantAId);
  const ticketCountByPriority: Record<string, number> = {};
  for (const t of tenantATickets) {
    ticketCountByPriority[t.priority] = (ticketCountByPriority[t.priority] ?? 0) + 1;
  }
  const slaBreachCount = tenantATickets.filter((t) => t.slaState === 'breached').length;

  return {
    ticketRows,
    reportDefRows,
    exportJobRows,
    expectedAggregates: {
      ticketCountTotal: tenantATickets.length,
      ticketCountByPriority,
      slaBreachCount,
      ticketCountTenantB: ticketRows.filter((t) => t.tenantId === tenantBId).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-built seed for use in test imports
// ---------------------------------------------------------------------------

export const REPORTING_TWELVE_MONTH_SEED = buildReportingTwelveMonthSeed();
