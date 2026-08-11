/**
 * AI event handlers — pure functions returning Redis mutation commands.
 *
 * Handles: ai.synthesis_completed.
 *
 * Only increments affected_area sorted set when ai_status = 'succeeded'.
 * Failed synthesis must not add incomplete area entries.
 */

import { Keys } from '../redis/keys';
import type { MutationCmd } from '../redis/aggregate.store';
import type { OutboxEvent } from '../outbox-event.schema';

// ---------------------------------------------------------------------------
// ai.synthesis_completed
// ---------------------------------------------------------------------------

export function handleAiSynthesisCompleted(event: OutboxEvent): MutationCmd[] {
  const p = event.payload;
  const tenantId = event.tenantId;
  const cmds: MutationCmd[] = [];

  // Only process successful synthesis (AC-5 edge case: failures must not add entries)
  if (String(p['aiStatus']) !== 'succeeded') {
    return cmds;
  }

  const areas = p['affectedAreas'] as Array<{ areaLabel: string; confidence?: string }> | undefined;
  if (!areas || areas.length === 0) return cmds;

  const seen = new Set<string>();
  for (const area of areas) {
    const label = String(area.areaLabel ?? '').toLowerCase().trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    // Use confidence as increment weight; default 1 if absent
    const weight = parseFloat(area.confidence ?? '1') || 1;
    cmds.push(['ZINCRBY', Keys.affectedArea(tenantId), weight, label]);
  }

  return cmds;
}
