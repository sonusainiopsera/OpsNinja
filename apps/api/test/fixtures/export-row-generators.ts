/**
 * Export row generators for WO-076 AC12.
 *
 * Provides:
 *  - generateRows(count)        — synthetic rows for size/performance testing
 *  - ROWS_1K / ROWS_100K / ROWS_500K — pre-built row arrays at standard scales
 *  - AWKWARD_VALUES_ROWS        — fixture with quotes, commas, newlines, unicode,
 *                                  nulls and formula-injection prefixes for
 *                                  serializer correctness tests
 */

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

export interface ExportRow {
  ticket_id:    string;
  priority:     string;
  status:       string;
  created_at:   string;
  ticket_count: number;
  org_id:       string;
}

// ---------------------------------------------------------------------------
// Synthetic row generator
// ---------------------------------------------------------------------------

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const STATUSES   = ['open', 'in_progress', 'resolved', 'closed'];

/**
 * Generate `count` synthetic export rows deterministically (no Math.random).
 * Row values cycle through small sets so results are reproducible and
 * the fixture stays deterministic across runs.
 */
export function generateRows(count: number): ExportRow[] {
  const rows: ExportRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      ticket_id:    `tkt-${String(i).padStart(8, '0')}`,
      priority:     PRIORITIES[i % PRIORITIES.length]!,
      status:       STATUSES[i % STATUSES.length]!,
      created_at:   `2024-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
      ticket_count: (i % 100) + 1,
      org_id:       `org-${String(Math.trunc(i / 1000)).padStart(4, '0')}`,
    });
  }
  return rows;
}

// Pre-built standard-scale arrays.
export const ROWS_1K:   ExportRow[] = generateRows(1_000);
export const ROWS_100K: ExportRow[] = generateRows(100_000);
// 500K is large — defer to generateRows(500_000) at use site to avoid
// storing 500K objects in module scope during test collection.
export function generate500kRows(): ExportRow[] {
  return generateRows(500_000);
}

// ---------------------------------------------------------------------------
// Awkward-values fixture — for CSV serializer correctness
// ---------------------------------------------------------------------------

export interface AwkwardRow {
  description:       string | null;
  note:              string | null;
  formula_cell:      string | null;
  unicode_cell:      string | null;
  newline_cell:      string | null;
  empty_cell:        string | null;
}

/**
 * Rows specifically designed to exercise quoting edge cases in CsvStreamSerializer:
 *  - embedded commas
 *  - embedded double-quotes (RFC 4180 §2.7)
 *  - embedded newlines (CR, LF, CRLF)
 *  - unicode multi-byte characters and emoji
 *  - null values (must render as empty string)
 *  - formula-injection prefixes (=, +, -, @, TAB, CR)
 */
export const AWKWARD_VALUES_ROWS: AwkwardRow[] = [
  {
    description:  'plain text',
    note:         null,                                    // null → empty
    formula_cell: '=HYPERLINK("http://evil.com","Click")', // formula injection
    unicode_cell: '日本語テスト',                           // CJK
    newline_cell: 'line1\nline2',                          // LF
    empty_cell:   '',
  },
  {
    description:  'Smith, John',                           // embedded comma
    note:         'He said "hello"',                       // embedded double-quote
    formula_cell: '+MALICIOUS()',                          // + prefix
    unicode_cell: '🚀🌍🎉',                                // emoji
    newline_cell: 'line1\r\nline2',                        // CRLF
    empty_cell:   '',
  },
  {
    description:  'Amount: $1,000.00',                     // comma in currency
    note:         'Has\ttab and "quote"',                   // mixed special chars
    formula_cell: '-1+1',                                  // - prefix
    unicode_cell: 'Ñoño résumé naïve café',                // latin extended
    newline_cell: 'only\rCR',                              // CR
    empty_cell:   null,
  },
  {
    description:  '@mention user',                         // @ prefix
    note:         undefined as unknown as null,            // undefined → empty
    formula_cell: '\t=tabbed formula',                     // TAB prefix
    unicode_cell: '​ zero-width space',               // zero-width
    newline_cell: 'no special chars here',
    empty_cell:   '',
  },
  {
    description:  'x'.repeat(1500),                        // very long value
    note:         '"quoted" "multiple" "times"',            // multiple quotes
    formula_cell: '=A1+B1',
    unicode_cell: '© copyright ™ trademark',     // special symbols
    newline_cell: 'normal',
    empty_cell:   null,
  },
];

// Column descriptors matching AwkwardRow keys — for use with CsvStreamSerializer.
export const AWKWARD_COLUMNS = [
  { key: 'description',  label: 'Description' },
  { key: 'note',         label: 'Note' },
  { key: 'formula_cell', label: 'Formula Cell' },
  { key: 'unicode_cell', label: 'Unicode Cell' },
  { key: 'newline_cell', label: 'Newline Cell' },
  { key: 'empty_cell',   label: 'Empty Cell' },
];

// Column descriptors for the synthetic ExportRow shape.
export const EXPORT_ROW_COLUMNS = [
  { key: 'ticket_id',    label: 'Ticket ID' },
  { key: 'priority',     label: 'Priority' },
  { key: 'status',       label: 'Status' },
  { key: 'created_at',   label: 'Created At' },
  { key: 'ticket_count', label: 'Ticket Count' },
  { key: 'org_id',       label: 'Organisation ID' },
];
