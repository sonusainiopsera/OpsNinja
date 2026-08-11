/**
 * report-pdf.template.ts — self-contained HTML template builder for PDF reports (WO-077).
 *
 * SECURITY GUARANTEES:
 *   1. Every value from report data is passed through escapeHtml() before interpolation.
 *   2. No remote assets: fonts are system-safe web-safe stacks, CSS is inline,
 *      ECharts is referenced only by a bundled path (ECHARTS_BUNDLE_PATH).
 *   3. The page is designed to be loaded from a data URL so no file:// or http://
 *      references are required.
 *   4. Triple-stache / dangerouslySetInnerHTML are not used here — all string
 *      building uses explicit escapeHtml() calls.
 *
 * Output: a complete <!DOCTYPE html> document string suitable for passing to
 *   page.setContent() in Puppeteer/Playwright.
 *
 * Print layout:
 *   - @page rules: A4 portrait, 15mm margins.
 *   - Table headers repeat on every page (thead).
 *   - page-break-inside: avoid on table rows.
 *   - Very wide tables: columns truncated with overflow:hidden + text-overflow:ellipsis.
 *   - Empty state: explicit "No data" message when rows.length === 0.
 *   - Right-to-left text mitigation: unicode-bidi: plaintext on data cells.
 *   - Long unbroken strings: word-break: break-word.
 *
 * The header / footer are injected via Chromium pdf() headerTemplate /
 * footerTemplate options rather than absolute-positioned HTML so they appear
 * on every page even after Chromium's paginator splits the content.
 */

import { escapeHtml } from './html-escape';
import {
  buildChartOption,
  buildChartScript,
  type ChartType,
  type ChartColumn,
  type ChartDataRow,
} from './chart-option.builder';

export interface PdfTemplateData {
  /** Tenant display name — shown in header */
  tenantName:    string;
  /** Report definition title */
  reportTitle:   string;
  /** ISO-8601 timestamp of the data snapshot */
  dataAsOf:      string;
  /** Columns (dimension + metric) */
  columns:       ChartColumn[];
  /** Result rows */
  rows:          ChartDataRow[];
  /** Chart type; 'table' renders only an HTML table */
  chartType:     ChartType;
  /**
   * Absolute path to the bundled ECharts UMD file inside the worker image.
   * e.g. '/usr/share/opsninja/echarts.min.js'
   * Only used when chartType != 'table'.
   * If null/undefined, charts are omitted.
   */
  echartsPath?:  string | null;
  /** Data-classification marking (default: 'Confidential') */
  classification?: string;
}

/** Maximum characters per cell before truncation with ellipsis. */
const MAX_CELL_CHARS = 200;

function truncateCell(value: unknown): string {
  const s = escapeHtml(value);
  if (s.length <= MAX_CELL_CHARS) return s;
  return s.slice(0, MAX_CELL_CHARS) + '…';
}

function buildTableHtml(columns: ChartColumn[], rows: ChartDataRow[]): string {
  const headers = columns
    .map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`)
    .join('');

  if (rows.length === 0) {
    const colspan = columns.length || 1;
    return (
      `<table class="data-table">\n` +
      `  <thead><tr>${headers}</tr></thead>\n` +
      `  <tbody>\n` +
      `    <tr><td colspan="${colspan}" class="empty-state">` +
      `No data available for this report. Use CSV export for large datasets.</td></tr>\n` +
      `  </tbody>\n` +
      `</table>`
    );
  }

  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const raw = row[c.key];
          return `<td class="cell">${truncateCell(raw)}</td>`;
        })
        .join('');
      return `  <tr>${cells}</tr>`;
    })
    .join('\n');

  return (
    `<table class="data-table">\n` +
    `  <thead><tr>${headers}</tr></thead>\n` +
    `  <tbody>\n${bodyRows}\n  </tbody>\n` +
    `</table>`
  );
}

/**
 * Build the <body> content string, including an optional chart section
 * followed by the data table.
 */
function buildBodyContent(data: PdfTemplateData): string {
  const { columns, rows, chartType, echartsPath } = data;
  const parts: string[] = [];

  // Chart section (only for bar/line and when echartsPath is provided)
  if (chartType !== 'table' && echartsPath) {
    const chartResult = buildChartOption(chartType, columns, rows);
    if (chartResult) {
      const containerId = 'chart-main';
      const script = buildChartScript(containerId, chartResult.option);
      // The chart div height is fixed; Chromium will include it above the table.
      parts.push(
        `<section class="chart-section" aria-label="Chart visualisation">\n` +
        `  <div id="${containerId}" class="chart-container" role="img" aria-label="Report chart"></div>\n` +
        `</section>\n` +
        script,
      );
    }
  }

  // Table section
  parts.push(
    `<section class="table-section">\n` +
    buildTableHtml(columns, rows) +
    `\n</section>`,
  );

  if (columns.length > 8) {
    parts.push(
      `<p class="footnote">Table has ${escapeHtml(columns.length)} columns. ` +
      `Wide columns are truncated — use CSV export for complete data.</p>`,
    );
  }

  return parts.join('\n');
}

/**
 * Generate a Chromium-compatible headerTemplate string.
 * Chromium headerTemplate uses a special CSS class .pageNumber and .totalPages.
 * The template must be self-contained (inline styles only, no external resources).
 */
export function buildHeaderTemplate(tenantName: string, reportTitle: string): string {
  const safeTenant = escapeHtml(tenantName);
  const safeTitle  = escapeHtml(reportTitle);
  return (
    `<div style="width:100%;font-family:Arial,sans-serif;font-size:9px;` +
    `color:#374151;display:flex;justify-content:space-between;` +
    `padding:0 15mm;border-bottom:1px solid #E5E7EB;padding-bottom:4px;">` +
    `<span>${safeTenant}</span>` +
    `<span>${safeTitle}</span>` +
    `</div>`
  );
}

/**
 * Generate a Chromium-compatible footerTemplate string.
 * .pageNumber and .totalPages are replaced by Chromium automatically.
 */
export function buildFooterTemplate(
  dataAsOf: string,
  classification: string,
): string {
  const safeDate  = escapeHtml(dataAsOf);
  const safeClass = escapeHtml(classification);
  return (
    `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;` +
    `color:#6B7280;display:flex;justify-content:space-between;` +
    `padding:0 15mm;border-top:1px solid #E5E7EB;padding-top:4px;">` +
    `<span>Data as of: ${safeDate}</span>` +
    `<span class="pageNumber"></span> of <span class="totalPages"></span>` +
    `<span style="color:#EF4444;font-weight:bold;">${safeClass}</span>` +
    `</div>`
  );
}

/** Inline CSS for the report document. No external font or stylesheet references. */
const INLINE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

@page {
  size: A4 portrait;
  margin: 20mm 15mm 20mm 15mm;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10pt;
  color: #1F2937;
  margin: 0;
  padding: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

h1 {
  font-size: 14pt;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4mm 0;
}

.chart-container {
  width: 100%;
  height: 280px;
  margin-bottom: 8mm;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  word-break: break-word;
  page-break-inside: auto;
}

.data-table thead {
  display: table-header-group;
  background-color: #F9FAFB;
}

.data-table th {
  padding: 6px 8px;
  text-align: left;
  font-weight: 600;
  font-size: 9pt;
  color: #374151;
  border-bottom: 2px solid #E5E7EB;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-table tr {
  page-break-inside: avoid;
}

.data-table tbody tr:nth-child(even) {
  background-color: #F9FAFB;
}

.cell {
  padding: 5px 8px;
  border-bottom: 1px solid #F3F4F6;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 9pt;
  unicode-bidi: plaintext;
  overflow-wrap: break-word;
}

.empty-state {
  padding: 20px;
  text-align: center;
  color: #6B7280;
  font-style: italic;
}

.footnote {
  font-size: 8pt;
  color: #6B7280;
  margin-top: 4mm;
  font-style: italic;
}

.chart-section { page-break-after: avoid; }
.table-section  { page-break-before: avoid; }
`;

/**
 * Build a complete, self-contained HTML document for PDF rendering.
 *
 * All report data values are HTML-escaped.
 * No remote assets are referenced.
 * The ECharts library is loaded from a bundled path inside the worker image.
 *
 * @returns Complete HTML string ready for page.setContent() or data URL encoding.
 */
export function buildPdfHtml(data: PdfTemplateData): string {
  const classification = data.classification ?? 'Confidential';
  const safeTitle      = escapeHtml(data.reportTitle);
  const safeTenant     = escapeHtml(data.tenantName);
  const safeDataAsOf   = escapeHtml(data.dataAsOf);
  const safeClass      = escapeHtml(classification);

  const bodyContent = buildBodyContent(data);

  // ECharts script tag — only bundled path, never a CDN URL.
  const echartsTag =
    data.chartType !== 'table' && data.echartsPath
      ? `<script src="${escapeHtml(data.echartsPath)}"></script>\n`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>${safeTitle}</title>
  <style>${INLINE_CSS}</style>
  ${echartsTag}
</head>
<body>
  <header>
    <h1>${safeTenant} — ${safeTitle}</h1>
    <p style="font-size:9pt;color:#6B7280;margin:0 0 6mm 0;">
      Data as of: ${safeDataAsOf} &nbsp;|&nbsp;
      <strong style="color:#EF4444;">${safeClass}</strong>
    </p>
  </header>
  <main>
    ${bodyContent}
  </main>
</body>
</html>`;
}

/**
 * Map the raw export job payload + query rows into PdfTemplateData.
 *
 * @param payload  - export_job.queued outbox payload
 * @param rows     - rows returned from the reporting replica
 * @param tenantName - tenant display name
 * @param echartsPath - absolute path to bundled ECharts inside the image
 */
export function mapExportPayloadToTemplateData(
  payload: {
    columns:   ChartColumn[];
    rowCap:    number;
    requestedBy: string;
    reportTitle?: string;
    chartType?:  ChartType;
    tenantName?: string;
    dataAsOf?:   string;
  },
  rows: ChartDataRow[],
  tenantName: string,
  echartsPath?: string | null,
): PdfTemplateData {
  return {
    tenantName:     tenantName,
    reportTitle:    payload.reportTitle ?? 'Report',
    dataAsOf:       payload.dataAsOf ?? new Date().toISOString(),
    columns:        payload.columns,
    rows,
    chartType:      payload.chartType ?? 'table',
    echartsPath:    echartsPath ?? null,
    classification: 'Confidential',
  };
}
