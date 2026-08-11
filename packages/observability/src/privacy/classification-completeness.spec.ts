/**
 * Build-time classification completeness check.
 *
 * Reflects over the exported Drizzle table definitions from @opsninja/db and
 * asserts that every column has a corresponding entry in the classification
 * registry.  The test FAILS if any column is unclassified, printing missing
 * entries as actionable output so the developer knows exactly what to add.
 *
 * This test is intentionally placed in the observability package (not db)
 * so the shared privacy registry owns the completeness requirement.
 */

import { describe, it, expect } from 'vitest';
import * as schema from '@opsninja/db';
import { CLASSIFICATION_REGISTRY } from './classification.registry';

// ---------------------------------------------------------------------------
// Extract the column key names from a Drizzle table definition.
// A Drizzle table object has a symbol key [Table.Symbol.Columns] that holds
// all column definitions. We walk Object.keys of the table itself instead,
// since Drizzle exposes columns as camelCase enumerable properties.
// ---------------------------------------------------------------------------

function getTableColumns(tableObj: unknown): string[] {
  if (typeof tableObj !== 'object' || tableObj === null) return [];
  // Drizzle tables expose column builders as own enumerable properties
  return Object.keys(tableObj as object).filter(
    (k) => !k.startsWith('_') && !k.startsWith('['),
  );
}

// ---------------------------------------------------------------------------
// Map from exported schema name → table definition
//
// We only include tables (not type exports or non-table values).
// A Drizzle table has a Symbol property that identifies it; as a simpler
// heuristic, we include any export that is a plain object with keys and has
// a property named 'tenantId', 'id', or is keyed in the registry.
// ---------------------------------------------------------------------------

function isLikelyTable(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const keys = Object.keys(value as object);
  // Drizzle table objects are instances of a class with Symbol-keyed metadata
  // and also expose column property keys. Minimum guard: at least two own keys
  // and not a plain data object.
  return keys.length >= 2 && keys.every((k) => typeof k === 'string');
}

describe('Classification Registry Completeness', () => {
  it('every schema table column has a classification entry', () => {
    const missing: Array<{ entity: string; field: string }> = [];

    for (const [exportName, exportValue] of Object.entries(schema)) {
      // Skip type-only exports, functions, and string/number constants
      if (!isLikelyTable(exportValue)) continue;

      // Skip entities not yet in the registry — they must be added
      const entityEntry = CLASSIFICATION_REGISTRY[exportName];
      if (!entityEntry) {
        // This entire entity is unregistered — flag all its columns
        const cols = getTableColumns(exportValue);
        for (const col of cols) {
          missing.push({ entity: exportName, field: col });
        }
        continue;
      }

      // Compare column keys against the registry entry
      const cols = getTableColumns(exportValue);
      for (const col of cols) {
        if (!(col in entityEntry)) {
          missing.push({ entity: exportName, field: col });
        }
      }
    }

    if (missing.length > 0) {
      const lines = missing
        .map(({ entity, field }) => `  ${entity}.${field}`)
        .join('\n');
      throw new Error(
        `${missing.length} unclassified column(s) found in schema.\n` +
        `Add entries to CLASSIFICATION_REGISTRY in classification.registry.ts:\n${lines}`,
      );
    }

    expect(missing).toHaveLength(0);
  });

  it('every classification registry entry points to a known tier', () => {
    const validTiers = new Set(['public', 'internal', 'confidential', 'restricted']);
    const invalid: string[] = [];

    for (const [entity, fields] of Object.entries(CLASSIFICATION_REGISTRY)) {
      for (const [field, entry] of Object.entries(fields)) {
        if (!validTiers.has(entry.tier)) {
          invalid.push(`${entity}.${field}: unknown tier '${entry.tier}'`);
        }
      }
    }

    expect(invalid).toHaveLength(0);
  });

  it('every classification registry entry points to a known strategy', () => {
    const validStrategies = new Set(['none', 'mask', 'hash', 'tokenize', 'drop']);
    const invalid: string[] = [];

    for (const [entity, fields] of Object.entries(CLASSIFICATION_REGISTRY)) {
      for (const [field, entry] of Object.entries(fields)) {
        if (!validStrategies.has(entry.redactionStrategy)) {
          invalid.push(`${entity}.${field}: unknown strategy '${entry.redactionStrategy}'`);
        }
      }
    }

    expect(invalid).toHaveLength(0);
  });
});
