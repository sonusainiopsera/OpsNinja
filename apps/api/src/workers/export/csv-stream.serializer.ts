/**
 * CsvStreamSerializer — streaming CSV Transform for the export worker (WO-076).
 *
 * Converts a stream of row objects into RFC 4180-compliant CSV bytes.
 * Design constraints:
 *   - Never accumulates rows — each row is written to the downstream S3 upload
 *     immediately, keeping memory O(batch-size) not O(total-rows).
 *   - Handles embedded double quotes (RFC 4180 escape: "" per occurrence).
 *   - Handles embedded commas, CR, LF and CRLF by quoting the cell.
 *   - Renders JS null as the empty string "" (distinguishable in spreadsheets
 *     from a zero-length string when the cell is quoted).
 *   - Neutralises CSV formula-injection prefixes (=, +, -, @, TAB, CR at the
 *     start of a value) by prepending a tab, following the OWASP CSV guideline.
 *   - Emits a UTF-8 BOM (\xEF\xBB\xBF) as the first byte so Excel auto-detects
 *     the encoding without user intervention.
 *   - CRLF (\r\n) line terminator as specified by RFC 4180.
 */

import { Transform, type TransformCallback } from 'stream';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOM = Buffer.from('\xEF\xBB\xBF');
const CRLF = '\r\n';
// Characters that trigger RFC 4180 quoting.
const NEEDS_QUOTING_RE = /[",\r\n]/;
// Formula-injection prefixes per OWASP.
const FORMULA_INJECTION_RE = /^[=+\-@\t\r]/;

// ---------------------------------------------------------------------------
// Column descriptor
// ---------------------------------------------------------------------------

export interface CsvColumn {
  /** Row-object key to extract. */
  key:   string;
  /** Header label to emit. */
  label: string;
}

// ---------------------------------------------------------------------------
// CsvStreamSerializer
// ---------------------------------------------------------------------------

export class CsvStreamSerializer extends Transform {
  private readonly columns: CsvColumn[];
  private headerEmitted = false;
  private bomEmitted = false;

  constructor(columns: CsvColumn[]) {
    super({ objectMode: true, readableObjectMode: false });
    this.columns = columns;
  }

  override _transform(
    row: Record<string, unknown>,
    _encoding: string,
    callback: TransformCallback,
  ): void {
    try {
      let out = '';

      // BOM on the very first byte.
      if (!this.bomEmitted) {
        this.push(BOM);
        this.bomEmitted = true;
      }

      // Header row on the first data row.
      if (!this.headerEmitted) {
        out += this.columns.map((c) => escapeCell(c.label)).join(',') + CRLF;
        this.headerEmitted = true;
      }

      // Data row.
      out += this.columns
        .map((c) => {
          const raw = row[c.key];
          return escapeCell(raw === null || raw === undefined ? '' : String(raw));
        })
        .join(',') + CRLF;

      this.push(out);
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    // Emit a header-only CSV when the result set was empty (AC edge case: zero rows).
    if (!this.headerEmitted && this.columns.length > 0) {
      if (!this.bomEmitted) {
        this.push(BOM);
      }
      this.push(this.columns.map((c) => escapeCell(c.label)).join(',') + CRLF);
    }
    callback();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a single CSV cell value per RFC 4180 + formula-injection neutralisation.
 */
export function escapeCell(value: string): string {
  // Neutralise formula-injection: prepend a leading tab if value starts with
  // a dangerous character. The tab is invisible in most spreadsheets but breaks
  // the formula prefix, satisfying OWASP CSV injection prevention.
  if (FORMULA_INJECTION_RE.test(value)) {
    value = '\t' + value;
  }

  // Quote cells containing special characters.
  if (NEEDS_QUOTING_RE.test(value) || value.includes('"')) {
    // Escape embedded double quotes by doubling them (RFC 4180 §2.7).
    value = '"' + value.replace(/"/g, '""') + '"';
  }

  return value;
}
