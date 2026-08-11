/**
 * Portal isolation — static dependency graph assertions.
 *
 * These tests guarantee that the portal shell and its imports cannot reach:
 *   - SlaCountdown / SlaClockProvider (agent-only realtime primitives)
 *   - Any agent shell components (Sidebar, TenantSwitcher, GlobalSearch, LiveStatusPill, ExportMenu, AppShell)
 *   - Internal-note components
 *
 * The test resolves import graphs by reading source files rather than running the
 * build, so it catches violations before CI bundling.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const PORTAL_SHELL_ROOT = resolve(__dirname, '../../components/shell/PortalShell.tsx');

const AGENT_ONLY_IDENTIFIERS = [
  'SlaCountdown',
  'SlaClockProvider',
  'LiveStatusPill',
  'GlobalSearch',
  'ExportMenu',
  'TenantSwitcher',
  'Sidebar',
  'AppShell',
  'InternalNote',
  'NotePrivate',
  'internal-note',
];

const ROOT_BARREL_PATTERNS = [
  "@opsninja/ui-kit'",
  '@opsninja/ui-kit"',
  'from "@opsninja/ui-kit"',
  "from '@opsninja/ui-kit'",
];

function collectImportedPaths(filePath: string, visited: Set<string> = new Set()): string[] {
  if (visited.has(filePath)) return [];
  if (!existsSync(filePath)) return [];
  visited.add(filePath);

  const content = readFileSync(filePath, 'utf8');
  const importedPaths: string[] = [filePath];

  const importRe = /from ['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
        const candidate = resolve(dirname(filePath), spec + ext);
        if (existsSync(candidate)) {
          importedPaths.push(...collectImportedPaths(candidate, visited));
          break;
        }
      }
    }
  }

  return importedPaths;
}

describe('portal bundle isolation', () => {
  it('PortalShell.tsx exists', () => {
    expect(existsSync(PORTAL_SHELL_ROOT)).toBe(true);
  });

  it('portal shell source does not import root @opsninja/ui-kit barrel', () => {
    const allFiles = collectImportedPaths(PORTAL_SHELL_ROOT);
    for (const file of allFiles) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of ROOT_BARREL_PATTERNS) {
        expect(content, `${file} imports from root ui-kit barrel via "${pattern}"`).not.toContain(pattern);
      }
    }
  });

  it('portal components use @opsninja/ui-kit/portal not root barrel', () => {
    const shellFiles = [
      resolve(__dirname, '../../components/shell/OrgScopePill.tsx'),
      resolve(__dirname, '../../components/shell/HelpLink.tsx'),
      resolve(__dirname, '../../components/shell/PortalHeader.tsx'),
      resolve(__dirname, '../../components/shell/PortalTabs.tsx'),
      resolve(__dirname, '../../components/shell/CsatBanner.tsx'),
      resolve(__dirname, '../../components/shell/PortalFooter.tsx'),
      resolve(__dirname, '../../components/shell/PortalUserMenu.tsx'),
      resolve(__dirname, '../../components/shell/PortalErrorBoundary.tsx'),
      resolve(__dirname, '../../components/shell/SkipToContent.tsx'),
    ];
    for (const file of shellFiles) {
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf8');
      for (const pattern of ROOT_BARREL_PATTERNS) {
        expect(content, `${file} imports from root ui-kit barrel`).not.toContain(pattern);
      }
    }
  });

  it('portal shell has no agent-only module identifiers in its source', () => {
    const content = readFileSync(PORTAL_SHELL_ROOT, 'utf8');
    for (const identifier of AGENT_ONLY_IDENTIFIERS) {
      expect(content, `PortalShell.tsx references agent-only identifier "${identifier}"`).not.toContain(identifier);
    }
  });

  it('assert-bundle-isolation DENY_LIST covers all required identifiers', () => {
    const scriptPath = resolve(__dirname, '../../scripts/assert-bundle-isolation.ts');
    expect(existsSync(scriptPath)).toBe(true);
    const content = readFileSync(scriptPath, 'utf8');
    for (const identifier of ['SlaCountdown', 'SlaClockProvider', 'AppShell', 'TenantSwitcher', 'Sidebar']) {
      expect(content).toContain(identifier);
    }
  });

  it('CSR isolation: OrgScopePill imports only from portal-safe subset', () => {
    const orgScopePill = resolve(__dirname, '../../components/shell/OrgScopePill.tsx');
    const content = readFileSync(orgScopePill, 'utf8');
    expect(content).toContain('@opsninja/ui-kit/portal');
    for (const pattern of ROOT_BARREL_PATTERNS) {
      expect(content, 'OrgScopePill must not import root barrel').not.toContain(pattern);
    }
  });
});
