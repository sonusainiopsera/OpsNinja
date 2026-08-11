/**
 * Redaction scanner for built documentation output.
 *
 * Scans all .html, .json, and .md files under the target directory and fails
 * the build if any deny-list pattern matches.
 *
 * Usage (from repo root):
 *   npx ts-node -T docs/scripts/redaction-scan.ts [--dir docs/dist]
 *
 * The scanner exits with code 1 on any match, naming the file and pattern.
 * Use --dir to specify the target directory (defaults to docs/site for unit tests
 * and docs/dist for CI runs over built HTML).
 *
 * Deny-list patterns are defined in docs/site/config.ts and cover:
 *  - Production OpsNinja hostnames
 *  - Internal hostnames and RFC1918 addresses
 *  - JWT-shaped token strings
 *  - AWS access key prefixes
 *  - Hex strings of 64 characters (potential secrets)
 *  - Non-synthetic tenant UUID values
 */

import * as fs from 'fs';
import * as path from 'path';
import { PORTAL_CONFIG, type RedactionPattern } from '../site/config';

export interface ScanHit {
  file: string;
  line: number;
  pattern: string;
  matched: string;
}

export interface ScanResult {
  hits: ScanHit[];
  filesScanned: number;
  elapsedMs: number;
}

const SCANNED_EXTENSIONS = new Set(['.html', '.json', '.md', '.txt']);

// ── Scanner ───────────────────────────────────────────────────────────────────

function collectFiles(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, results);
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

function scanFile(filePath: string, patterns: readonly RedactionPattern[]): ScanHit[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const hits: ScanHit[] = [];

  for (const pattern of patterns) {
    // Reset lastIndex for global regexes before each file
    const re = new RegExp(pattern.pattern.source, pattern.pattern.flags.includes('g') ? pattern.pattern.flags : `${pattern.pattern.flags}g`);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      re.lastIndex = 0;
      const line = lines[lineIndex]!;
      let match: RegExpExecArray | null;

      while ((match = re.exec(line)) !== null) {
        hits.push({
          file: filePath,
          line: lineIndex + 1,
          pattern: pattern.name,
          matched: match[0].slice(0, 120), // cap at 120 chars to avoid logging secrets
        });
        // Prevent infinite loop on zero-width matches
        if (match.index === re.lastIndex) re.lastIndex++;
      }
    }
  }

  return hits;
}

export function runRedactionScan(
  targetDir: string,
  patterns: readonly RedactionPattern[] = PORTAL_CONFIG.redactionDenyList,
): ScanResult {
  const start = Date.now();
  const files = collectFiles(targetDir);
  const hits: ScanHit[] = [];

  for (const file of files) {
    hits.push(...scanFile(file, patterns));
  }

  return {
    hits,
    filesScanned: files.length,
    elapsedMs: Date.now() - start,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const targetDir = dirIdx !== -1 && args[dirIdx + 1]
    ? path.resolve(args[dirIdx + 1]!)
    : path.resolve(__dirname, '../../docs/site');

  console.log(`🔍 Redaction scan: ${targetDir}`);

  const result = runRedactionScan(targetDir);

  console.log(`   Scanned ${result.filesScanned} file(s) in ${result.elapsedMs}ms`);

  if (result.hits.length === 0) {
    console.log('✅ No redaction violations found.');
    process.exit(0);
  }

  console.error(`\n❌ ${result.hits.length} redaction violation(s) found:\n`);
  for (const hit of result.hits) {
    console.error(`  ${hit.file}:${hit.line}  [${hit.pattern}]`);
    console.error(`    Matched: "${hit.matched}"`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}
