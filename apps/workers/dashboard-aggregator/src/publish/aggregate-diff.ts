/**
 * aggregate-diff.ts — WO-069
 *
 * Pure, framework-free diff function that computes a delta payload from
 * two aggregate snapshots.  Returns null when nothing changed (suppressed
 * publication).
 *
 * Design rules:
 *  - No side effects; every input is read-only.
 *  - All changed KPI counters are included in `kpis`.
 *  - Category / affected-area entries are compared by label; changed counts
 *    (including removals and additions) are emitted in `categoryDelta` /
 *    `affectedAreaDelta`.
 *  - Breach-risk rows are compared by ticketId; added rows go in
 *    `breachRiskAdded`, removed ticketIds go in `breachRiskRemoved`.
 *  - Feed entries added since the last snapshot appear in `feedAppended`.
 *  - An undefined `prev` triggers a full-state frame (first publication or
 *    after Redis restart).
 */

// ---------------------------------------------------------------------------
// Snapshot types (mirrors the AggregateStore read helpers)
// ---------------------------------------------------------------------------

export interface AggregateSnapshot {
  kpis:         Record<string, number>;
  category:     Array<{ category: string; count: number }>;
  affectedArea: Array<{ area: string; count: number }>;
  breachRisk:   Array<{ ticketId: string; nextFireAt: number }>;
  feed:         string[];
}

// ---------------------------------------------------------------------------
// Delta payload types (wire format, shared with gateway and client)
// ---------------------------------------------------------------------------

export interface KpiDelta {
  [field: string]: number;
}

export interface CategoryDeltaEntry {
  categoryPath: string;
  count: number;
}

export interface AffectedAreaDeltaEntry {
  areaTag: string;
  count: number;
}

export interface BreachRiskRow {
  ticketId: string;
  nextFireAt: number;
}

export interface DeltaPayload {
  /** Only fields whose value changed */
  kpis?: KpiDelta;
  categoryDelta?: CategoryDeltaEntry[];
  affectedAreaDelta?: AffectedAreaDeltaEntry[];
  breachRiskAdded?: BreachRiskRow[];
  breachRiskRemoved?: string[];
  feedAppended?: string[];
}

export interface FramePayload {
  type: 'delta' | 'snapshot';
  payload: DeltaPayload | AggregateSnapshot;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function diffMap(
  prev: Record<string, number>,
  curr: Record<string, number>,
): Record<string, number> | null {
  const changes: Record<string, number> = {};
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  for (const k of allKeys) {
    const pv = prev[k] ?? 0;
    const cv = curr[k] ?? 0;
    if (pv !== cv) changes[k] = cv;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function diffArrayByLabel<T extends { [key: string]: unknown }>(
  prev: T[],
  curr: T[],
  labelKey: keyof T,
  countKey: keyof T,
): T[] | null {
  const prevMap = new Map<unknown, number>(
    prev.map((e) => [e[labelKey], e[countKey] as number]),
  );
  const currMap = new Map<unknown, number>(
    curr.map((e) => [e[labelKey], e[countKey] as number]),
  );

  const changes: T[] = [];

  // Changed or added entries in curr
  for (const entry of curr) {
    const label = entry[labelKey];
    const prevCount = prevMap.get(label) ?? 0;
    const currCount = entry[countKey] as number;
    if (prevCount !== currCount) {
      changes.push(entry);
    }
  }

  // Removed entries (present in prev but not in curr)
  for (const entry of prev) {
    const label = entry[labelKey];
    if (!currMap.has(label)) {
      // Signal removal with count=0
      changes.push({ ...entry, [countKey]: 0 } as T);
    }
  }

  return changes.length > 0 ? changes : null;
}

function diffBreachRisk(
  prev: BreachRiskRow[],
  curr: BreachRiskRow[],
): { added: BreachRiskRow[]; removed: string[] } | null {
  const prevMap = new Map<string, number>(prev.map((r) => [r.ticketId, r.nextFireAt]));
  const currMap = new Map<string, number>(curr.map((r) => [r.ticketId, r.nextFireAt]));

  const added: BreachRiskRow[] = [];
  const removed: string[] = [];

  for (const row of curr) {
    const prevScore = prevMap.get(row.ticketId);
    if (prevScore === undefined || prevScore !== row.nextFireAt) {
      added.push(row);
    }
  }

  for (const row of prev) {
    if (!currMap.has(row.ticketId)) {
      removed.push(row.ticketId);
    }
  }

  if (added.length === 0 && removed.length === 0) return null;
  return { added, removed };
}

function diffFeed(prev: string[], curr: string[]): string[] | null {
  if (curr.length === 0) return null;
  // Feed is a prepend list (LPUSH); new entries are at the front.
  // Identify entries that did not exist in prev.
  const prevSet = new Set(prev);
  const appended = curr.filter((e) => !prevSet.has(e));
  return appended.length > 0 ? appended : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a delta payload between `prev` and `curr`.
 *
 * @returns { type: 'delta', payload } when changes exist,
 *          { type: 'snapshot', payload: curr } when `prev` is undefined (full state),
 *          null when nothing changed (publish suppressed).
 */
export function computeDiff(
  prev: AggregateSnapshot | undefined,
  curr: AggregateSnapshot,
): FramePayload | null {
  // No previous state — emit full snapshot (first publish or after Redis reset)
  if (!prev) {
    return { type: 'snapshot', payload: curr };
  }

  const kpiChanges = diffMap(prev.kpis, curr.kpis);

  const categoryChanges = diffArrayByLabel(
    prev.category,
    curr.category,
    'category',
    'count',
  );

  const affectedAreaChanges = diffArrayByLabel(
    prev.affectedArea,
    curr.affectedArea,
    'area',
    'count',
  );

  const breachRiskChanges = diffBreachRisk(prev.breachRisk, curr.breachRisk);

  const feedChanges = diffFeed(prev.feed, curr.feed);

  const hasChanges =
    kpiChanges !== null ||
    categoryChanges !== null ||
    affectedAreaChanges !== null ||
    breachRiskChanges !== null ||
    feedChanges !== null;

  if (!hasChanges) return null;

  const delta: DeltaPayload = {};
  if (kpiChanges) delta.kpis = kpiChanges;
  if (categoryChanges) {
    delta.categoryDelta = categoryChanges.map((e) => ({
      categoryPath: e.category as string,
      count: e.count as number,
    }));
  }
  if (affectedAreaChanges) {
    delta.affectedAreaDelta = affectedAreaChanges.map((e) => ({
      areaTag: e.area as string,
      count: e.count as number,
    }));
  }
  if (breachRiskChanges) {
    if (breachRiskChanges.added.length > 0) delta.breachRiskAdded = breachRiskChanges.added;
    if (breachRiskChanges.removed.length > 0) delta.breachRiskRemoved = breachRiskChanges.removed;
  }
  if (feedChanges) delta.feedAppended = feedChanges;

  return { type: 'delta', payload: delta };
}
