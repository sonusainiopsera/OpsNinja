/**
 * portal-dependency.test.ts
 *
 * Asserts that the portal entry point (src/portal.ts) does NOT transitively
 * import SlaCountdown or SlaClockProvider.
 *
 * This is a source-scan test (reads file text, no runtime import) so it works
 * without a full bundler resolution.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '..');

function collectTransitiveImports(filePath: string, visited = new Set<string>()): Set<string> {
  if (visited.has(filePath)) return visited;
  visited.add(filePath);

  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return visited;
  }

  // Match static import/export from '...' or require('...')
  const importRe = /(?:from|require)\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue; // skip node_modules

    const resolved = resolveLocalPath(filePath, spec);
    if (resolved) {
      collectTransitiveImports(resolved, visited);
    }
  }
  return visited;
}

function resolveLocalPath(fromFile: string, spec: string): string | null {
  const dir = path.dirname(fromFile);
  const candidates = [
    path.resolve(dir, spec),
    path.resolve(dir, spec + '.ts'),
    path.resolve(dir, spec + '.tsx'),
    path.resolve(dir, spec, 'index.ts'),
    path.resolve(dir, spec, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

describe('portal entry point dependency boundary', () => {
  const portalEntry = path.resolve(SRC_DIR, 'portal.ts');

  it('portal.ts exists', () => {
    expect(fs.existsSync(portalEntry)).toBe(true);
  });

  it('portal.ts does not transitively import SlaCountdown', () => {
    const allImports = collectTransitiveImports(portalEntry);
    const slaCountdownFiles = [...allImports].filter(f =>
      f.includes('SlaCountdown') && !f.includes('__tests__'),
    );
    expect(slaCountdownFiles).toHaveLength(0);
  });

  it('portal.ts does not transitively import SlaClockProvider', () => {
    const allImports = collectTransitiveImports(portalEntry);
    const clockProviderFiles = [...allImports].filter(f =>
      f.includes('SlaClockProvider') && !f.includes('__tests__'),
    );
    expect(clockProviderFiles).toHaveLength(0);
  });

  it('main index.ts DOES include SlaCountdown', () => {
    const indexEntry = path.resolve(SRC_DIR, 'index.ts');
    const allImports = collectTransitiveImports(indexEntry);
    const slaFiles = [...allImports].filter(f => f.includes('SlaCountdown') && !f.includes('__tests__'));
    expect(slaFiles.length).toBeGreaterThan(0);
  });
});
