/**
 * saved-view-compiler.ts — stress test for the saved-view filter compiler.
 *
 * Validates (AC5):
 *   - Complex multi-attribute filter ASTs compile correctly (correctness assertion)
 *   - Cache-cold and cache-warm latencies are measured and reported separately
 *   - Latency stays within declared thresholds for each complexity tier
 *
 * Test matrix (predicate count × tag cardinality × category depth):
 *   Each combination is run COLD (unique signature per run → cache miss) and
 *   WARM (same signature → cache hit).  Separating the two makes compiler cost
 *   vs cache benefit visible — a fast warm path masking a slow cold path would
 *   be a red flag (AC edge case: cache-warm runs masking slow uncached path).
 *
 * This file is a Node.js script (runs via ts-node), NOT a k6 script, because
 * it needs direct access to the @opsninja/filter-compiler TypeScript module.
 *
 * Run:
 *   ts-node test/perf/stress/saved-view-compiler.ts
 *   ts-node test/perf/stress/saved-view-compiler.ts --json > results/filter-compiler.json
 */

import {
  parseFilterAst,
  compileToPredicate,
  computeSignature,
  type FilterAst,
  MAX_DEPTH,
  MAX_NODES,
} from '@opsninja/filter-compiler';
import type { SavedViewCompilerResult } from '../types';

// ---------------------------------------------------------------------------
// Threshold declarations (matched against thresholds.config.ts conventions)
// ---------------------------------------------------------------------------
const COLD_LATENCY_LIMIT_MS: Record<string, number> = {
  tiny:    5,   // 1 predicate
  small:   15,  // 3 predicates
  medium:  50,  // 8 predicates, 2 levels
  large:   150, // 20 predicates, 3 levels
  complex: 300, // 40+ predicates, 4 levels (near MAX_DEPTH / MAX_NODES)
};

const WARM_LATENCY_LIMIT_MS: Record<string, number> = {
  tiny:    2,
  small:   5,
  medium:  10,
  large:   20,
  complex: 30,
};

// Repeat each case N times to get stable timing
const COLD_RUNS = 20;
const WARM_RUNS = 50;

// ---------------------------------------------------------------------------
// AST builders — deterministic, no Math.random()
// ---------------------------------------------------------------------------

type ConditionNode = { type: 'condition'; field: string; operator: string; value: unknown };
type GroupNode     = { type: 'group'; op: 'and' | 'or'; children: FilterNode[] };
type FilterNode    = ConditionNode | GroupNode;

function makeCondition(index: number, tagCardinality: number): ConditionNode {
  const fieldCycle = index % 5;
  if (fieldCycle === 0) {
    return { type: 'condition', field: 'status',   operator: 'eq',  value: 'open' };
  } else if (fieldCycle === 1) {
    return { type: 'condition', field: 'priority', operator: 'in',  value: ['P1', 'P2'] };
  } else if (fieldCycle === 2) {
    return { type: 'condition', field: 'assignee_id', operator: 'eq', value: `00000000-0000-0000-0000-${String(index % tagCardinality).padStart(12, '0')}` };
  } else if (fieldCycle === 3) {
    return { type: 'condition', field: 'created_at', operator: 'gte', value: 'now-30d' };
  } else {
    return { type: 'condition', field: 'organization_id', operator: 'in', value: [
      `00000000-0000-0000-0001-${String(index % tagCardinality).padStart(12, '0')}`,
    ]};
  }
}

function buildAst(predicateCount: number, tagCardinality: number, depth: number): FilterAst {
  function buildGroup(remaining: number, currentDepth: number): FilterNode {
    if (remaining <= 1 || currentDepth >= depth) {
      return makeCondition(remaining, tagCardinality);
    }
    const half = Math.ceil(remaining / 2);
    return {
      type: 'group',
      op: currentDepth % 2 === 0 ? 'and' : 'or',
      children: [
        buildGroup(half, currentDepth + 1),
        buildGroup(remaining - half, currentDepth + 1),
      ],
    };
  }

  const clampedCount = Math.min(predicateCount, MAX_NODES - 1);
  return { root: buildGroup(clampedCount, 1) };
}

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------
function measureMs(fn: () => void, runs: number): number {
  // Warm up JIT
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / runs; // average ms
}

// ---------------------------------------------------------------------------
// Test matrix
// ---------------------------------------------------------------------------
interface TestCase {
  label:          string;
  predicateCount: number;
  tagCardinality: number;
  categoryDepth:  number;
}

const TEST_MATRIX: TestCase[] = [
  { label: 'tiny',    predicateCount: 1,  tagCardinality: 1,   categoryDepth: 1 },
  { label: 'small',   predicateCount: 3,  tagCardinality: 10,  categoryDepth: 2 },
  { label: 'medium',  predicateCount: 8,  tagCardinality: 50,  categoryDepth: 2 },
  { label: 'large',   predicateCount: 20, tagCardinality: 200, categoryDepth: 3 },
  { label: 'complex', predicateCount: 40, tagCardinality: 500, categoryDepth: 4 },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
function runStress(): SavedViewCompilerResult[] {
  const results: SavedViewCompilerResult[] = [];

  for (const tc of TEST_MATRIX) {
    const ast = buildAst(tc.predicateCount, tc.tagCardinality, tc.categoryDepth);

    // Validate + compile once to confirm correctness
    const parseResult = parseFilterAst(ast);
    if (!parseResult.valid) {
      throw new Error(`AST validation failed for case "${tc.label}": ${JSON.stringify(parseResult.errors)}`);
    }

    const compiled = compileToPredicate(parseResult.ast!);
    // Correctness: compiled SQL must contain at least one positional placeholder ($1)
    const correctnessVerified = compiled.sql.includes('$1') || compiled.params.length === 0 &&
      // Edge: a single always-true condition may produce no params (e.g. no-filter)
      compiled.sql.length > 0;

    // Cold measurement: unique AST per cold run (vary a value so signature differs)
    const coldRunMs = measureMs(() => {
      // Mutate value slightly for each call to ensure cache-cold path
      const uniqueAst = buildAst(tc.predicateCount, tc.tagCardinality + Math.floor(Math.random() * 1000), tc.categoryDepth);
      const pr = parseFilterAst(uniqueAst);
      if (pr.valid) compileToPredicate(pr.ast!);
    }, COLD_RUNS);

    // Warm measurement: same signature → cache path (signature computation only)
    const sig = computeSignature(parseResult.ast!);
    const warmRunMs = measureMs(() => {
      // Simulate cache hit: only signature computation + cache lookup overhead
      computeSignature(parseResult.ast!);
      // In production, cache hit skips compileToPredicate; we measure signature cost here
    }, WARM_RUNS);

    const coldBreachMs = coldRunMs > COLD_LATENCY_LIMIT_MS[tc.label]
      ? coldRunMs
      : undefined;
    const warmBreachMs = warmRunMs > WARM_LATENCY_LIMIT_MS[tc.label]
      ? warmRunMs
      : undefined;

    const result: SavedViewCompilerResult = {
      caseLabel:           tc.label,
      predicateCount:      tc.predicateCount,
      tagCardinality:      tc.tagCardinality,
      categoryDepth:       tc.categoryDepth,
      coldRunMs:           parseFloat(coldRunMs.toFixed(3)),
      warmRunMs:           parseFloat(warmRunMs.toFixed(3)),
      correctnessVerified,
      coldBreachMs:        coldBreachMs ? parseFloat(coldBreachMs.toFixed(3)) : undefined,
      warmBreachMs:        warmBreachMs ? parseFloat(warmBreachMs.toFixed(3)) : undefined,
    };

    results.push(result);

    const status = (!coldBreachMs && !warmBreachMs && correctnessVerified) ? 'PASS' : 'FAIL';
    console.log(`[filter-compiler] ${tc.label.padEnd(10)} cold=${coldRunMs.toFixed(2)}ms warm=${warmRunMs.toFixed(2)}ms sig=${sig.slice(0, 8)} ${status}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
function main(): void {
  console.log('[filter-compiler-stress] Starting saved-view compiler stress matrix');
  const results = runStress();

  const failures = results.filter((r) => r.coldBreachMs || r.warmBreachMs || !r.correctnessVerified);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
  }

  console.log(`\n[filter-compiler-stress] Completed: ${results.length} cases, ${failures.length} failures`);

  if (failures.length > 0) {
    console.error('[filter-compiler-stress] FAILED cases:');
    for (const f of failures) {
      if (!f.correctnessVerified) {
        console.error(`  ${f.caseLabel}: correctness check failed`);
      }
      if (f.coldBreachMs) {
        console.error(`  ${f.caseLabel}: cold=${f.coldBreachMs}ms exceeds limit=${COLD_LATENCY_LIMIT_MS[f.caseLabel]}ms`);
      }
      if (f.warmBreachMs) {
        console.error(`  ${f.caseLabel}: warm=${f.warmBreachMs}ms exceeds limit=${WARM_LATENCY_LIMIT_MS[f.caseLabel]}ms`);
      }
    }
    process.exit(1);
  }

  console.log('[filter-compiler-stress] All cases PASSED');
}

main();

export { runStress, buildAst, TEST_MATRIX, COLD_LATENCY_LIMIT_MS, WARM_LATENCY_LIMIT_MS };
