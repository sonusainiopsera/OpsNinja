/**
 * Unit tests for chart-option.builder.ts — WO-077 AC-5, AC-10.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildChartOption,
  buildChartScript,
  type ChartColumn,
  type ChartDataRow,
} from './chart-option.builder';

const COLUMNS: ChartColumn[] = [
  { key: 'd_organization', label: 'organization' },
  { key: 'm_ticket_count', label: 'ticket count' },
  { key: 'm_avg_resolution_minutes', label: 'avg resolution minutes' },
];

const ROWS: ChartDataRow[] = [
  { d_organization: 'Acme Corp',    m_ticket_count: 42,  m_avg_resolution_minutes: 120 },
  { d_organization: 'Globex Ltd',   m_ticket_count: 17,  m_avg_resolution_minutes: 85  },
  { d_organization: 'Initech Inc',  m_ticket_count: 91,  m_avg_resolution_minutes: 200 },
];

describe('buildChartOption — bar chart', () => {
  it('returns null for table chart type', () => {
    expect(buildChartOption('table', COLUMNS, ROWS)).toBeNull();
  });

  it('returns a non-null result for bar chart', () => {
    const result = buildChartOption('bar', COLUMNS, ROWS);
    expect(result).not.toBeNull();
  });

  it('sets animation:false for headless rendering', () => {
    const result = buildChartOption('bar', COLUMNS, ROWS)!;
    expect(result.option.animation).toBe(false);
  });

  it('uses first dimension column as category axis', () => {
    const result = buildChartOption('bar', COLUMNS, ROWS)!;
    expect(result.dimensionKey).toBe('d_organization');
    const xAxis = result.option.xAxis as { data: string[] };
    expect(xAxis.data).toEqual(['Acme Corp', 'Globex Ltd', 'Initech Inc']);
  });

  it('creates one series per metric column', () => {
    const result = buildChartOption('bar', COLUMNS, ROWS)!;
    expect(result.metricKeys).toEqual(['m_ticket_count', 'm_avg_resolution_minutes']);
    const series = result.option.series as Array<{ name: string; data: number[] }>;
    expect(series).toHaveLength(2);
    expect(series[0]!.name).toBe('ticket count');
    expect(series[0]!.data).toEqual([42, 17, 91]);
    expect(series[1]!.name).toBe('avg resolution minutes');
    expect(series[1]!.data).toEqual([120, 85, 200]);
  });

  it('uses "bar" type for all series in bar chart', () => {
    const result = buildChartOption('bar', COLUMNS, ROWS)!;
    const series = result.option.series as Array<{ type: string }>;
    series.forEach((s) => expect(s.type).toBe('bar'));
  });

  it('replaces null values with 0', () => {
    const rows: ChartDataRow[] = [
      { d_organization: 'A', m_ticket_count: null, m_avg_resolution_minutes: 10 },
    ];
    const result = buildChartOption('bar', COLUMNS, rows)!;
    const series = result.option.series as Array<{ data: number[] }>;
    expect(series[0]!.data[0]).toBe(0);
  });

  it('replaces non-finite values with 0', () => {
    const rows: ChartDataRow[] = [
      { d_organization: 'B', m_ticket_count: Infinity, m_avg_resolution_minutes: NaN },
    ];
    const result = buildChartOption('bar', COLUMNS, rows)!;
    const series = result.option.series as Array<{ data: number[] }>;
    expect(series[0]!.data[0]).toBe(0);
    expect(series[1]!.data[0]).toBe(0);
  });

  it('returns null when there are no metric columns', () => {
    const dimOnly: ChartColumn[] = [{ key: 'd_organization', label: 'org' }];
    expect(buildChartOption('bar', dimOnly, ROWS)).toBeNull();
  });

  it('returns null when there are no dimension columns', () => {
    const metricOnly: ChartColumn[] = [{ key: 'm_ticket_count', label: 'count' }];
    expect(buildChartOption('bar', metricOnly, ROWS)).toBeNull();
  });

  it('produces a JSON-serialisable option', () => {
    const result = buildChartOption('bar', COLUMNS, ROWS)!;
    expect(() => JSON.stringify(result.option)).not.toThrow();
  });
});

describe('buildChartOption — line chart', () => {
  it('sets type:"line" for all series', () => {
    const result = buildChartOption('line', COLUMNS, ROWS)!;
    const series = result.option.series as Array<{ type: string; smooth: boolean }>;
    series.forEach((s) => {
      expect(s.type).toBe('line');
      expect(s.smooth).toBe(true);
    });
  });
});

describe('buildChartScript', () => {
  it('embeds the containerId safely', () => {
    const option = buildChartOption('bar', COLUMNS, ROWS)!.option;
    const script = buildChartScript('chart-0', option);
    expect(script).toContain('"chart-0"');
    expect(script).toContain('echarts.init');
    expect(script).toContain('setOption');
  });

  it('wraps in a <script> tag', () => {
    const option = buildChartOption('bar', COLUMNS, ROWS)!.option;
    const script = buildChartScript('c1', option);
    expect(script).toMatch(/^<script>/);
    expect(script).toMatch(/<\/script>$/);
  });

  it('produces valid JSON inside the script', () => {
    const option = buildChartOption('bar', COLUMNS, ROWS)!.option;
    const script = buildChartScript('c1', option);
    // Extract JSON from setOption(...)
    const m = /setOption\((.+)\);/.exec(script);
    expect(m).not.toBeNull();
    expect(() => JSON.parse(m![1]!)).not.toThrow();
  });

  it('does not reference any external URLs', () => {
    const option = buildChartOption('line', COLUMNS, ROWS)!.option;
    const script = buildChartScript('c2', option);
    expect(script).not.toMatch(/https?:\/\//);
    expect(script).not.toMatch(/data:/);
  });
});

describe('custom palette from env', () => {
  const original = process.env['PDF_CHART_COLORS'];

  beforeEach(() => {
    process.env['PDF_CHART_COLORS'] = '#FF0000,#00FF00,#0000FF';
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['PDF_CHART_COLORS'];
    } else {
      process.env['PDF_CHART_COLORS'] = original;
    }
  });

  it('uses the custom palette when PDF_CHART_COLORS is set', () => {
    const result = buildChartOption('bar', COLUMNS, ROWS)!;
    const colors = result.option.color as string[];
    expect(colors).toContain('#FF0000');
    expect(colors).toContain('#00FF00');
  });
});
