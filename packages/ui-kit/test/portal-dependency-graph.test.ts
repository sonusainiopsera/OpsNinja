/**
 * portal-dependency-graph.test.ts
 *
 * Asserts that the portal-safe bundle entry point (src/portal.ts) does NOT
 * transitively import SlaCountdown or SlaClockProvider.
 *
 * This test works by reading the source files as text and tracing import
 * statements. It does NOT execute the modules, so it is safe even if the
 * components have side effects or DOM dependencies.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const ROOT = resolve(import.meta.dirname ?? __dirname, '..');
const PORTAL_ENTRY = resolve(ROOT, 'src/portal.ts');

const FORBIDDEN_MODULES = [
  'SlaCountdown/SlaCountdown',
  'SlaClockProvider',
];

function extractImports(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const staticImports = [...content.matchAll(/^\s*(?:import|export)[^'"]*['"]([^'"]+)['"]/gm)].map(
      (m) => m[1]!,
    );
    return staticImports;
  } catch {
    return [];
  }
}

function resolveImport(from: string, importPath: string): string | null {
  if (!importPath.startsWith('.')) return null;
  const base = dirname(from);
  const resolved = resolve(base, importPath);
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    try {
      readFileSync(resolved + ext);
      return resolved + ext;
    } catch {
      // continue
    }
  }
  return null;
}

function collectTransitiveImports(entryFile: string, visited = new Set<string>()): Set<string> {
  if (visited.has(entryFile)) return visited;
  visited.add(entryFile);
  const imports = extractImports(entryFile);
  for (const imp of imports) {
    const resolved = resolveImport(entryFile, imp);
    if (resolved) {
      collectTransitiveImports(resolved, visited);
    }
  }
  return visited;
}

describe('portal-dependency-graph', () => {
  it('portal.ts exists', () => {
    expect(() => readFileSync(PORTAL_ENTRY)).not.toThrow();
  });

  it.each(FORBIDDEN_MODULES)(
    'portal.ts does not transitively import %s',
    (forbidden) => {
      const allImported = collectTransitiveImports(PORTAL_ENTRY);
      const violators = [...allImported].filter((f) => f.includes(forbidden));
      expect(violators).toHaveLength(0);
    },
  );

  it('portal.ts exports SlaHint (smoke-check reachability)', () => {
    const allImported = collectTransitiveImports(PORTAL_ENTRY);
    const hasSlaHint = [...allImported].some((f) => f.includes('SlaHint'));
    expect(hasSlaHint).toBe(true);
  });
});
