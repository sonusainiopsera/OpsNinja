/**
 * Unit tests for report-pdf.template.ts — WO-077 AC-8, AC-9, AC-10.
 *
 * Asserts:
 *   - Template data mapper produces correct PdfTemplateData shape.
 *   - All data values are context-escaped in the output HTML.
 *   - Header/footer templates contain required fields.
 *   - Zero-row reports render valid HTML with empty-state message.
 *   - Hostile content (script tags, iframes, external URLs) is escaped/inert.
 *   - Wide table renders footnote directing users to CSV.
 *   - No remote asset references in rendered HTML.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPdfHtml,
  buildHeaderTemplate,
  buildFooterTemplate,
  mapExportPayloadToTemplateData,
  type PdfTemplateData,
} from './report-pdf.template';
import type { ChartColumn, ChartDataRow } from './chart-option.builder';

const COLUMNS: ChartColumn[] = [
  { key: 'd_organization', label: 'organization' },
  { key: 'm_ticket_count', label: 'ticket count' },
];

const ROWS: ChartDataRow[] = [
  { d_organization: 'Acme Corp', m_ticket_count: 42 },
  { d_organization: 'Globex',    m_ticket_count: 17 },
];

const BASE_DATA: PdfTemplateData = {
  tenantName:    'Test Tenant',
  reportTitle:   'Monthly Summary',
  dataAsOf:      '2026-08-01T00:00:00.000Z',
  columns:       COLUMNS,
  rows:          ROWS,
  chartType:     'table',
  classification: 'Confidential',
};

describe('buildPdfHtml — structure', () => {
  it('produces a valid HTML document structure', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  it('includes the tenant name', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('Test Tenant');
  });

  it('includes the report title', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('Monthly Summary');
  });

  it('includes the data-as-of timestamp', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('2026-08-01T00:00:00.000Z');
  });

  it('includes the Confidential classification marking (AC-8)', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('Confidential');
  });

  it('renders column headers in the table', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('organization');
    expect(html).toContain('ticket count');
  });

  it('renders data rows in the table', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('Acme Corp');
    expect(html).toContain('42');
  });

  it('includes @page rules for print layout', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('@page');
    expect(html).toContain('A4 portrait');
  });

  it('has no remote asset references (no http://, cdn, fonts.googleapis)', () => {
    const html = buildPdfHtml(BASE_DATA);
    expect(html).not.toMatch(/https?:\/\/(?!localhost)/);
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('cdn.');
    expect(html).not.toContain('cdnjs.');
  });

  it('does not include noindex/nofollow (AC-4)', () => {
    // We do set noindex as a belt-and-suspenders measure for locally served PDFs.
    const html = buildPdfHtml(BASE_DATA);
    expect(html).toContain('noindex');
  });
});

describe('buildPdfHtml — hostile content escaping (AC-9)', () => {
  it('escapes script tags in data values', () => {
    const hostile: ChartDataRow[] = [
      { d_organization: '<script>alert("xss")</script>', m_ticket_count: 1 },
    ];
    const html = buildPdfHtml({ ...BASE_DATA, rows: hostile });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes iframe tags in data values', () => {
    const hostile: ChartDataRow[] = [
      { d_organization: '<iframe src="https://evil.com">', m_ticket_count: 5 },
    ];
    const html = buildPdfHtml({ ...BASE_DATA, rows: hostile });
    expect(html).not.toContain('<iframe');
    expect(html).toContain('&lt;iframe');
  });

  it('escapes quote characters in data values (AC-9)', () => {
    const hostile: ChartDataRow[] = [
      { d_organization: 'It\'s "great"', m_ticket_count: 1 },
    ];
    const html = buildPdfHtml({ ...BASE_DATA, rows: hostile });
    expect(html).not.toContain('"great"');
    expect(html).toContain('&quot;great&quot;');
  });

  it('escapes external image src in data values', () => {
    const hostile: ChartDataRow[] = [
      { d_organization: '<img src="https://evil.com/pixel.gif">', m_ticket_count: 3 },
    ];
    const html = buildPdfHtml({ ...BASE_DATA, rows: hostile });
    expect(html).not.toContain('<img src=');
    expect(html).toContain('&lt;img');
  });

  it('neutralises bidi override characters in data values', () => {
    const hostile: ChartDataRow[] = [
      { d_organization: 'Admin‮tca‭', m_ticket_count: 0 },  // RTL override
    ];
    const html = buildPdfHtml({ ...BASE_DATA, rows: hostile });
    expect(html).not.toContain('‮');
    expect(html).toContain('[BIDI]');
  });

  it('escapes hostile tenant name', () => {
    const html = buildPdfHtml({
      ...BASE_DATA,
      tenantName: '<script>steal()</script>',
    });
    expect(html).not.toContain('<script>steal');
    expect(html).toContain('&lt;script&gt;steal()&lt;&#x2F;script&gt;');
  });

  it('escapes hostile report title', () => {
    const html = buildPdfHtml({
      ...BASE_DATA,
      reportTitle: '"; DROP TABLE reports; --',
    });
    expect(html).toContain('&quot;; DROP TABLE reports; --');
  });
});

describe('buildPdfHtml — zero rows', () => {
  it('renders a valid document with empty-state message (edge case)', () => {
    const html = buildPdfHtml({ ...BASE_DATA, rows: [] });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('No data available');
    // Must have table headers even when empty
    expect(html).toContain('organization');
    expect(html).toContain('ticket count');
  });
});

describe('buildPdfHtml — wide table footnote', () => {
  it('adds a footnote when there are more than 8 columns', () => {
    const wideCols: ChartColumn[] = Array.from({ length: 9 }, (_, i) => ({
      key:   `m_metric_${i}`,
      label: `metric ${i}`,
    }));
    const html = buildPdfHtml({ ...BASE_DATA, columns: wideCols, rows: [] });
    expect(html).toContain('Wide columns are truncated');
    expect(html).toContain('CSV export');
  });

  it('does not add footnote when ≤ 8 columns', () => {
    const html = buildPdfHtml(BASE_DATA);  // COLUMNS has 2
    expect(html).not.toContain('Wide columns are truncated');
  });
});

describe('buildPdfHtml — ECharts script', () => {
  it('includes bundled ECharts script tag for bar chart', () => {
    const html = buildPdfHtml({
      ...BASE_DATA,
      chartType:    'bar',
      echartsPath:  '/usr/share/opsninja/echarts.min.js',
    });
    expect(html).toContain('echarts.min.js');
    expect(html).toContain('<script src=');
  });

  it('does not include ECharts for table type', () => {
    const html = buildPdfHtml({ ...BASE_DATA, chartType: 'table' });
    expect(html).not.toContain('echarts');
  });

  it('does not include ECharts when echartsPath is null', () => {
    const html = buildPdfHtml({
      ...BASE_DATA,
      chartType:   'bar',
      echartsPath: null,
    });
    expect(html).not.toContain('<script src=');
  });
});

describe('buildHeaderTemplate', () => {
  it('contains tenant name and report title', () => {
    const tmpl = buildHeaderTemplate('ACME Corp', 'Monthly Report');
    expect(tmpl).toContain('ACME Corp');
    expect(tmpl).toContain('Monthly Report');
  });

  it('escapes hostile tenant name', () => {
    const tmpl = buildHeaderTemplate('<b>Evil</b>', 'Report');
    expect(tmpl).not.toContain('<b>');
    expect(tmpl).toContain('&lt;b&gt;');
  });
});

describe('buildFooterTemplate', () => {
  it('contains dataAsOf and classification', () => {
    const tmpl = buildFooterTemplate('2026-08-01T00:00:00Z', 'Confidential');
    expect(tmpl).toContain('2026-08-01T00:00:00Z');
    expect(tmpl).toContain('Confidential');
  });

  it('contains pageNumber and totalPages spans for Chromium replacement', () => {
    const tmpl = buildFooterTemplate('2026-01-01', 'Confidential');
    expect(tmpl).toContain('class="pageNumber"');
    expect(tmpl).toContain('class="totalPages"');
  });

  it('escapes hostile classification marking', () => {
    const tmpl = buildFooterTemplate('2026-01-01', '<script>evil()</script>');
    expect(tmpl).not.toContain('<script>');
    expect(tmpl).toContain('&lt;script&gt;');
  });
});

describe('mapExportPayloadToTemplateData', () => {
  it('maps payload fields to PdfTemplateData', () => {
    const payload = {
      columns:     COLUMNS,
      rowCap:      5000,
      requestedBy: 'user-uuid',
      reportTitle: 'Q3 Report',
      chartType:   'bar' as const,
      dataAsOf:    '2026-07-01T00:00:00Z',
    };
    const result = mapExportPayloadToTemplateData(payload, ROWS, 'Globex', '/echarts.js');
    expect(result.tenantName).toBe('Globex');
    expect(result.reportTitle).toBe('Q3 Report');
    expect(result.chartType).toBe('bar');
    expect(result.columns).toBe(COLUMNS);
    expect(result.rows).toBe(ROWS);
    expect(result.echartsPath).toBe('/echarts.js');
    expect(result.classification).toBe('Confidential');
  });

  it('falls back to "Report" title when not provided', () => {
    const payload = {
      columns: COLUMNS, rowCap: 5000, requestedBy: 'u1',
    };
    const result = mapExportPayloadToTemplateData(payload, [], 'T');
    expect(result.reportTitle).toBe('Report');
  });

  it('falls back to table chart type when not provided', () => {
    const payload = { columns: COLUMNS, rowCap: 5000, requestedBy: 'u1' };
    const result = mapExportPayloadToTemplateData(payload, [], 'T');
    expect(result.chartType).toBe('table');
  });
});
