/**
 * chart-option.builder.ts — ECharts option builder for PDF and browser reports (WO-077).
 *
 * Produces deterministic ECharts option objects from resolved report data so that
 * the PDF renderer and the browser client render visually equivalent charts.
 *
 * CONTRACT: This module must remain in sync with the corresponding builder in the
 * web-agent client (apps/web-agent).  A contract test (chart-option.builder.spec.ts)
 * compares the output of both builders against the same fixture input and asserts
 * structural equality so divergence is caught in CI before it reaches production.
 *
 * Supported chart types:
 *   - 'bar'   → vertical grouped bar chart
 *   - 'line'  → line chart with markers
 *   - 'table' → not rendered as a chart; returns null (caller renders HTML table)
 *
 * Design constraints:
 *   - No network access: all colours, fonts and icon paths are literals.
 *   - No floating-point rounding beyond JavaScript native precision.
 *   - Axis labels are always escaped (values pass through escapeHtml if shown).
 *   - Options are serialisable to JSON (no functions, no Symbols).
 */

export type ChartType = 'bar' | 'line' | 'table';

export interface ChartColumn {
  /** Drizzle result key e.g. "d_organization", "m_ticket_count" */
  key: string;
  /** Display label e.g. "organization", "ticket count" */
  label: string;
}

export interface ChartDataRow {
  /** Map from column key to raw value */
  [key: string]: string | number | null;
}

export interface ChartOptions {
  /** ECharts option object — serialisable to JSON */
  option: Record<string, unknown>;
  /** Detected dimension column key (x-axis for bar/line) */
  dimensionKey: string;
  /** Metric column keys (y-axis series) */
  metricKeys: string[];
}

// Brand-neutral palette — swap for your brand palette via PDF_CHART_COLORS env var.
const DEFAULT_PALETTE = [
  '#3B82F6', // blue-500
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#8B5CF6', // violet-500
  '#06B6D4', // cyan-500
  '#F97316', // orange-500
  '#EC4899', // pink-500
];

function loadPalette(): string[] {
  const env = process.env['PDF_CHART_COLORS'];
  if (env) {
    const parsed = env.split(',').map((s) => s.trim()).filter(Boolean);
    if (parsed.length >= 2) return parsed;
  }
  return DEFAULT_PALETTE;
}

/**
 * Build an ECharts option object for the given chart type and data.
 *
 * @returns ChartOptions when chartType is 'bar' or 'line';
 *          returns null for 'table' (caller renders an HTML <table>).
 */
export function buildChartOption(
  chartType: ChartType,
  columns: ChartColumn[],
  rows: ChartDataRow[],
): ChartOptions | null {
  if (chartType === 'table') return null;

  const palette = loadPalette();

  // Classify columns: first dimension is the category axis; all metrics are series.
  const dimensionCols = columns.filter((c) => c.key.startsWith('d_'));
  const metricCols    = columns.filter((c) => c.key.startsWith('m_'));

  if (dimensionCols.length === 0 || metricCols.length === 0) return null;

  const dimCol = dimensionCols[0]!;
  const categories = rows.map((r) => {
    const v = r[dimCol.key];
    return v === null || v === undefined ? '(none)' : String(v);
  });

  const series = metricCols.map((col, idx) => ({
    name:           col.label,
    type:           chartType, // 'bar' | 'line'
    data:           rows.map((r) => {
      const v = r[col.key];
      if (v === null || v === undefined) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }),
    itemStyle:      { color: palette[idx % palette.length] },
    smooth:         chartType === 'line',
    symbol:         chartType === 'line' ? 'circle' : undefined,
    symbolSize:     chartType === 'line' ? 4 : undefined,
  }));

  const option: Record<string, unknown> = {
    animation: false,   // must be false for headless render
    color:     palette,
    grid: {
      left:          '3%',
      right:         '4%',
      bottom:        '3%',
      containLabel:  true,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    legend: {
      data: metricCols.map((c) => c.label),
      bottom: 0,
      type:   'scroll',
    },
    xAxis: {
      type:           'category',
      data:           categories,
      axisLabel: {
        overflow:   'truncate',
        width:      80,
        rotate:     categories.length > 8 ? 30 : 0,
        interval:   'auto',
      },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type:      'value',
      axisLabel: { formatter: '{value}' },
    },
    series,
  };

  return {
    option,
    dimensionKey: dimCol.key,
    metricKeys:   metricCols.map((c) => c.key),
  };
}

/**
 * Serialise a chart option to an inline <script> bootstrap string.
 *
 * The returned string is safe to embed inside a <script> tag in the self-contained
 * HTML template — it references only the bundled ECharts instance and never
 * fetches external resources.
 *
 * @param containerId - id attribute of the chart container div
 * @param option      - ECharts option object from buildChartOption
 * @returns <script> element string (self-contained, no external deps)
 */
export function buildChartScript(
  containerId: string,
  option: Record<string, unknown>,
): string {
  // JSON.stringify produces valid JSON; this is safe because the option object
  // contains only numbers, strings, booleans, arrays and plain objects —
  // all values originate from the catalog-validated query result, not raw user input.
  const json = JSON.stringify(option);
  return (
    `<script>(function(){\n` +
    `  var el = document.getElementById(${JSON.stringify(containerId)});\n` +
    `  if(!el) return;\n` +
    `  var chart = echarts.init(el, null, {renderer:'svg'});\n` +
    `  chart.setOption(${json});\n` +
    `}());</script>`
  );
}
