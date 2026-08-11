/**
 * ContactImportService — WO-027.
 *
 * Parses a CSV byte buffer, validates every row through CreateContactSchema
 * (the same DTO used by the single-create path), and commits atomically — or
 * not at all if any row fails validation.
 *
 * Limits:
 *   - Max 5,000 rows per import.  Files exceeding this receive 422.
 *   - Max file size is enforced by the multipart body-size limit in main.ts.
 *
 * CSV format accepted:
 *   fullName,email,jobTitle,phone,portalAccessEnabled
 *   (header row required; columns may appear in any order)
 *   UTF-8 BOM is stripped before parsing.
 *   CRLF and LF both accepted.
 *   Quoted commas supported (simple RFC 4180 parsing).
 *
 * Returns a per-row report so the caller can present granular feedback without
 * a separate retry cycle.
 */

import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Contact } from '@opsninja/db';
import { CreateContactSchema, type CreateContactDto } from './dto/contact.dto';
import { ContactsRepository } from './contacts.repository';

// ---------------------------------------------------------------------------
// CSV parser (no external dependency — simple RFC 4180)
// ---------------------------------------------------------------------------

interface CsvRow {
  lineNumber: number;
  fields:     Record<string, string>;
}

function parseCsv(raw: string): { headers: string[]; rows: CsvRow[] } {
  // Strip UTF-8 BOM.
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw;

  // Normalise line endings.
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Remove trailing blank lines.
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const values = splitCsvLine(line);
    const fields: Record<string, string> = {};
    headers.forEach((h, idx) => {
      fields[h] = (values[idx] ?? '').trim();
    });
    rows.push({ lineNumber: i + 1, fields });
  }

  return { headers, rows };
}

/** Minimal RFC 4180 field splitter — handles double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Import result types
// ---------------------------------------------------------------------------

export type ImportRowStatus = 'ok' | 'error';

export interface ImportRowResult {
  line:    number;
  status:  ImportRowStatus;
  reason?: string;
  email?:  string;
}

export interface ImportResult {
  imported: number;
  failed:   number;
  rows:     ImportRowResult[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const MAX_IMPORT_ROWS = 5_000;

@Injectable()
export class ContactImportService {
  constructor(private readonly repo: ContactsRepository) {}

  async importFromCsv(
    tenantId:       string,
    organizationId: string,
    buffer:         Buffer,
    traceId?:       string,
  ): Promise<ImportResult> {
    const text = buffer.toString('utf8');
    const { rows } = parseCsv(text);

    if (rows.length === 0) {
      throw new UnprocessableEntityException({
        error: { code: 'IMPORT_EMPTY', message: 'CSV file contains no data rows.' },
      });
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      throw new UnprocessableEntityException({
        error: {
          code:    'IMPORT_TOO_LARGE',
          message: `Import exceeds the maximum of ${MAX_IMPORT_ROWS} rows.`,
          details: [{ rowCount: rows.length, cap: MAX_IMPORT_ROWS }],
        },
      });
    }

    // --------------------------------------------------------------------------
    // Validation pass — collect all errors before opening a write transaction.
    // --------------------------------------------------------------------------
    const results: ImportRowResult[] = [];
    const validDtos: Array<{ line: number; dto: CreateContactDto }> = [];
    const seenEmails = new Set<string>(); // detect duplicates within the file

    for (const row of rows) {
      const raw = {
        email:               row.fields['email'] ?? '',
        fullName:            row.fields['fullname'] ?? row.fields['full_name'] ?? '',
        jobTitle:            row.fields['jobtitle'] ?? row.fields['job_title'] ?? undefined,
        phone:               row.fields['phone'] ?? undefined,
        portalAccessEnabled: row.fields['portalaccessenabled'] === 'true',
      };

      const parsed = CreateContactSchema.safeParse(raw);

      if (!parsed.success) {
        results.push({
          line:   row.lineNumber,
          status: 'error',
          reason: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
        continue;
      }

      const email = parsed.data.email;
      if (seenEmails.has(email)) {
        results.push({
          line:   row.lineNumber,
          status: 'error',
          reason: `Duplicate email within import file: ${email}`,
        });
        continue;
      }
      seenEmails.add(email);

      validDtos.push({ line: row.lineNumber, dto: parsed.data });
      results.push({ line: row.lineNumber, status: 'ok', email });
    }

    const hasErrors = results.some((r) => r.status === 'error');

    // All-or-nothing: if any row failed, return the report without writing.
    if (hasErrors) {
      return {
        imported: 0,
        failed:   results.filter((r) => r.status === 'error').length,
        rows:     results,
      };
    }

    // --------------------------------------------------------------------------
    // Write pass — insert all rows.  The enclosing withTenantTransaction from
    // the controller guarantees atomicity across all inserts.
    // --------------------------------------------------------------------------
    let imported = 0;
    const writeResults: ImportRowResult[] = [];

    for (const { line, dto } of validDtos) {
      try {
        await this.repo.createContact(tenantId, organizationId, dto, traceId);
        writeResults.push({ line, status: 'ok', email: dto.email });
        imported++;
      } catch (err: unknown) {
        const pgCode = (err as { code?: string }).code;
        writeResults.push({
          line,
          status: 'error',
          reason: pgCode === '23505'
            ? `Email already exists: ${dto.email}`
            : 'Database error during insert.',
          email: dto.email,
        });
      }
    }

    return {
      imported,
      failed: writeResults.filter((r) => r.status === 'error').length,
      rows:   writeResults,
    };
  }
}
