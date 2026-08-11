/**
 * MSW handlers for the Reporting API — WO-078 AC-13.
 *
 * Provides fixtures for:
 *   - GET /api/v1/reports/field-catalog
 *   - GET /api/v1/reports
 *   - POST /api/v1/reports/run (normal, truncated, timeout cases)
 *   - POST /api/v1/reports
 *   - PATCH /api/v1/reports/:id
 *   - DELETE /api/v1/reports/:id
 */

import { http, HttpResponse } from 'msw';
import type {
  FieldCatalogResponse,
  ReportDefinition,
  RunReportResponse,
} from '../../api/reporting/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const MOCK_FIELD_CATALOG: FieldCatalogResponse = {
  dimensions: [
    {
      name: 'organization', label: 'Organization', dataType: 'uuid',
      fieldKind: 'dimension', allowedOperators: ['eq', 'in', 'not_in'],
    },
    {
      name: 'priority', label: 'Priority', dataType: 'text_enum',
      fieldKind: 'dimension', allowedOperators: ['eq', 'in', 'not_in'],
      enumValues: ['P1', 'P2', 'P3', 'P4'],
    },
    {
      name: 'status', label: 'Status', dataType: 'text_enum',
      fieldKind: 'dimension', allowedOperators: ['eq', 'in', 'not_in'],
      enumValues: ['open', 'in_progress', 'resolved', 'closed'],
    },
    {
      name: 'created_date', label: 'Created Date', dataType: 'date',
      fieldKind: 'dimension', allowedOperators: ['between', 'before', 'after'],
    },
    {
      name: 'resolved_date', label: 'Resolved Date', dataType: 'date',
      fieldKind: 'dimension', allowedOperators: ['between', 'before', 'after'],
    },
    {
      name: 'assignment_group', label: 'Assignment Group', dataType: 'text',
      fieldKind: 'dimension', allowedOperators: ['eq', 'contains'],
    },
  ],
  metrics: [
    {
      name: 'ticket_count', label: 'Ticket Count', dataType: 'integer',
      fieldKind: 'metric', allowedOperators: [],
    },
    {
      name: 'avg_resolution_minutes', label: 'Avg Resolution (min)', dataType: 'numeric',
      fieldKind: 'metric', allowedOperators: [],
    },
    {
      name: 'sla_attainment_pct', label: 'SLA Attainment %', dataType: 'numeric',
      fieldKind: 'metric', allowedOperators: [],
    },
    {
      name: 'sla_breach_count', label: 'SLA Breach Count', dataType: 'integer',
      fieldKind: 'metric', allowedOperators: [],
    },
  ],
};

const NOW = '2026-08-11T10:00:00.000Z';

export const MOCK_DEFINITIONS: ReportDefinition[] = [
  {
    id:               'def-001',
    tenantId:         'ten-001',
    name:             'Monthly SLA Summary',
    metrics:          ['ticket_count', 'sla_attainment_pct'],
    groupBy:          ['organization'],
    chartType:        'bar',
    filterAst:        null,
    scope:            'tenant',
    createdBy:        'usr-001',
    createdAt:        NOW,
    updatedAt:        NOW,
  },
  {
    id:               'def-002',
    tenantId:         'ten-001',
    name:             'My P1 Report',
    metrics:          ['ticket_count'],
    groupBy:          ['priority'],
    chartType:        'table',
    filterAst:        { type: 'condition', field: 'priority', operator: 'eq', value: 'P1' },
    scope:            'private',
    createdBy:        'usr-001',
    createdAt:        NOW,
    updatedAt:        NOW,
  },
];

export const MOCK_RUN_RESULT: RunReportResponse = {
  columns: [
    { key: 'd_organization',        label: 'organization'       },
    { key: 'm_ticket_count',        label: 'ticket count'       },
    { key: 'm_sla_attainment_pct',  label: 'sla attainment pct' },
  ],
  rows: [
    { d_organization: 'Acme Corp',   m_ticket_count: 42,  m_sla_attainment_pct: 95.2 },
    { d_organization: 'Globex Ltd',  m_ticket_count: 17,  m_sla_attainment_pct: 88.1 },
    { d_organization: 'Initech Inc', m_ticket_count: 91,  m_sla_attainment_pct: 72.3 },
  ],
  rowCount:          3,
  truncated:         false,
  previewCap:        1000,
  dataAsOf:          NOW,
  replicaLagSeconds: 2,
};

export const MOCK_RUN_TRUNCATED: RunReportResponse = {
  ...MOCK_RUN_RESULT,
  rowCount:  1000,
  truncated: true,
};

// ---------------------------------------------------------------------------
// State for mutation tracking in tests
// ---------------------------------------------------------------------------

let definitions = [...MOCK_DEFINITIONS];
let runBehaviour: 'normal' | 'truncated' | 'timeout' = 'normal';

export function resetReportingHandlers() {
  definitions = [...MOCK_DEFINITIONS];
  runBehaviour = 'normal';
}

export function setRunBehaviour(b: 'normal' | 'truncated' | 'timeout') {
  runBehaviour = b;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const reportingHandlers = [
  // Field catalog
  http.get('/api/v1/reports/field-catalog', () => {
    return HttpResponse.json(MOCK_FIELD_CATALOG);
  }),

  // List definitions
  http.get('/api/v1/reports', () => {
    return HttpResponse.json({ data: definitions });
  }),

  // Run report
  http.post('/api/v1/reports/run', async () => {
    if (runBehaviour === 'timeout') {
      return HttpResponse.json(
        { error: { code: 'REPORT_QUERY_TIMEOUT', message: 'Query timed out after 30s' } },
        { status: 504 },
      );
    }
    const result = runBehaviour === 'truncated' ? MOCK_RUN_TRUNCATED : MOCK_RUN_RESULT;
    return HttpResponse.json(result);
  }),

  // Create definition
  http.post('/api/v1/reports', async ({ request }) => {
    const body = await request.json() as Partial<ReportDefinition>;
    const newDef: ReportDefinition = {
      id:        `def-${Date.now()}`,
      tenantId:  'ten-001',
      name:      body.name ?? 'Untitled',
      metrics:   body.metrics ?? [],
      groupBy:   body.groupBy ?? [],
      chartType: body.chartType ?? 'table',
      filterAst: body.filterAst ?? null,
      scope:     body.scope ?? 'private',
      createdBy: 'usr-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    definitions = [...definitions, newDef];
    return HttpResponse.json(newDef, { status: 201 });
  }),

  // Update definition
  http.patch('/api/v1/reports/:id', async ({ params, request }) => {
    const { id } = params as { id: string };
    const body = await request.json() as Partial<ReportDefinition>;
    const idx = definitions.findIndex((d) => d.id === id);
    if (idx === -1) return HttpResponse.json({ error: { code: 'REPORT_NOT_FOUND' } }, { status: 404 });
    const updated = { ...definitions[idx]!, ...body, updatedAt: new Date().toISOString() };
    definitions = definitions.map((d) => (d.id === id ? updated : d));
    return HttpResponse.json(updated);
  }),

  // Delete definition
  http.delete('/api/v1/reports/:id', ({ params }) => {
    const { id } = params as { id: string };
    definitions = definitions.filter((d) => d.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),
];
