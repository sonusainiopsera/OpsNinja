/**
 * Webhook catalogue generator.
 *
 * Reads the shared event-type registry and generates:
 *  - docs/site/webhooks/index.md   — catalogue index page
 *  - docs/site/webhooks/<type>.md  — one page per event type
 *
 * Usage (from repo root):
 *   npx ts-node -T docs/scripts/generate-webhook-catalogue.ts
 *
 * The generator fails loudly if any registry entry:
 *  - Has no payloadSchema
 *  - Has an empty payloadSchema.properties
 *  - Has no examplePayload
 *
 * Build-gate contract: this script exits with code 1 on any failure so it can
 * be used as a CI gate via `node --require ts-node/register docs/scripts/generate-webhook-catalogue.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  EVENT_REGISTRY,
  MAX_WEBHOOK_DELIVERY_ATTEMPTS,
  WEBHOOK_BACKOFF_DELAYS_SECONDS,
  SIGNATURE_REPLAY_WINDOW_SECONDS,
  WEBHOOK_CONSUMER_TIMEOUT_SECONDS,
} from '../../packages/events/src/index';

import type { EventRegistryEntry, JsonSchemaObject } from '../../packages/events/src/event-registry';

const REPO_ROOT = path.resolve(__dirname, '../..');
const WEBHOOKS_OUT_DIR = path.join(REPO_ROOT, 'docs', 'site', 'webhooks');

// ── Validation ────────────────────────────────────────────────────────────────

function validateRegistry(): void {
  const errors: string[] = [];

  for (const entry of EVENT_REGISTRY) {
    if (!entry.payloadSchema) {
      errors.push(`${entry.eventType}: missing payloadSchema`);
      continue;
    }
    if (Object.keys(entry.payloadSchema.properties).length === 0) {
      errors.push(`${entry.eventType}: payloadSchema.properties is empty`);
    }
    if (!entry.examplePayload || Object.keys(entry.examplePayload).length === 0) {
      errors.push(`${entry.eventType}: missing examplePayload`);
    }
    if (!entry.trigger) {
      errors.push(`${entry.eventType}: missing trigger condition`);
    }
  }

  if (errors.length > 0) {
    console.error('Catalogue generation failed — registry validation errors:');
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
}

// ── Schema rendering ──────────────────────────────────────────────────────────

function renderSchemaTable(schema: JsonSchemaObject): string {
  const rows = Object.entries(schema.properties).map(([name, prop]) => {
    const type = Array.isArray(prop.type) ? prop.type.join(' | ') : prop.type;
    const required = schema.required?.includes(name) ? '✓' : '–';
    const desc = prop.description ?? '';
    const enumNote = prop.enum ? ` Enum: \`${prop.enum.join('`, `')}\`.` : '';
    return `| \`${name}\` | \`${type}\` | ${required} | ${desc}${enumNote} |`;
  });

  return [
    '| Field | Type | Required | Description |',
    '|-------|------|----------|-------------|',
    ...rows,
  ].join('\n');
}

// ── Per-event page ─────────────────────────────────────────────────────────

function renderEventPage(entry: EventRegistryEntry): string {
  const availabilityNotice =
    entry.availability === 'unavailable'
      ? `\n> **Note:** This event type is currently unavailable. It is present in the registry but not yet enabled for subscriptions.\n`
      : '';

  const classificationNote =
    entry.dataClassification === 'confidential'
      ? `\n> **Confidential data:** Fields marked \\[redacted\\] in the payload schema are omitted for portal-visible subscriptions.\n`
      : '';

  return `---
title: "Webhook Event: ${entry.eventType}"
audience: "integration-developer"
last-reviewed: "2026-08-11"
---

# ${entry.eventType}
${availabilityNotice}
${classificationNote}
${entry.description}

## Trigger

${entry.trigger}

## Delivery Guarantee

**${entry.deliveryGuarantee}** — your endpoint may receive the same event more than once. Use the
top-level \`id\` field as the idempotency key for deduplication.

## Ordering

${entry.orderingCaveat}

## Data Classification

**${entry.dataClassification}**

## Payload Schema

The \`data\` object in the canonical event envelope has the following shape:

${renderSchemaTable(entry.payloadSchema)}

## Example Payload

The full canonical event envelope for this event type:

\`\`\`json
${JSON.stringify(
  {
    id: '01910f2a-0000-7000-8000-000000000042',
    type: entry.eventType,
    occurredAt: '2026-01-15T10:00:00.000Z',
    tenantId: '00000000-0000-0000-0000-000000000001',
    data: entry.examplePayload,
  },
  null,
  2,
)}
\`\`\`

## See Also

- [Webhook Overview and Signature Verification](../guides/webhooks/index.md)
- [Webhook Catalogue Index](./index.md)
`;
}

// ── Index page ────────────────────────────────────────────────────────────────

function renderIndexPage(): string {
  const backoffTable = WEBHOOK_BACKOFF_DELAYS_SECONDS.map((delay, i) => {
    const attempt = i + 1;
    const delayStr = delay >= 60 ? `${delay / 60} minute${delay >= 120 ? 's' : ''}` : `${delay} second${delay !== 1 ? 's' : ''}`;
    return `| ${attempt} | ${delayStr} |`;
  }).join('\n');

  const eventRows = EVENT_REGISTRY.map((entry) => {
    const availability = entry.availability === 'unavailable' ? ' *(unavailable)*' : '';
    return `| [\`${entry.eventType}\`](./${entry.eventType.replace('.', '_')}.md)${availability} | ${entry.resource} | ${entry.dataClassification} | ${entry.description} |`;
  }).join('\n');

  return `---
title: "Outbound Webhook Catalogue"
audience: "integration-developer"
last-reviewed: "2026-08-11"
---

# Outbound Webhook Catalogue

This catalogue is generated from the shared event-type registry — the same source of truth used
by the delivery worker. Every event type emitted by OpsNinja is listed here.

For signature verification, delivery guarantees, retry schedule and subscription management, see
[Outbound Webhooks](../guides/webhooks/index.md).

## Delivery Configuration

| Parameter | Value |
|-----------|-------|
| Delivery guarantee | At-least-once |
| Maximum delivery attempts | ${MAX_WEBHOOK_DELIVERY_ATTEMPTS} |
| Consumer response timeout | ${WEBHOOK_CONSUMER_TIMEOUT_SECONDS} seconds |
| Signature replay window | ${SIGNATURE_REPLAY_WINDOW_SECONDS} seconds (${SIGNATURE_REPLAY_WINDOW_SECONDS / 60} minutes) |

### Retry Backoff Schedule

| Attempt | Delay before retry |
|---------|--------------------|
| 1       | Immediate          |
${backoffTable}

## Event Types

| Event Type | Resource | Classification | Description |
|------------|----------|----------------|-------------|
${eventRows}

## Schema Evolution

Webhook payload schemas follow the same deprecation policy as the REST API. New fields may be
added without notice (additive). Removed or renamed fields carry a 6-month deprecation window.
See [Versioning and Deprecation](../guides/versioning-and-deprecation.md).
`;
}

// ── File system output ────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) return false;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('🔍 Validating event registry…');
  validateRegistry();

  ensureDir(WEBHOOKS_OUT_DIR);

  // Index page
  const indexContent = renderIndexPage();
  const indexChanged = writeIfChanged(path.join(WEBHOOKS_OUT_DIR, 'index.md'), indexContent);
  console.log(`${indexChanged ? '✓' : '–'} docs/site/webhooks/index.md`);

  // Per-event pages
  let changed = 0;
  for (const entry of EVENT_REGISTRY) {
    const filename = `${entry.eventType.replace('.', '_')}.md`;
    const content = renderEventPage(entry);
    const didChange = writeIfChanged(path.join(WEBHOOKS_OUT_DIR, filename), content);
    console.log(`${didChange ? '✓' : '–'} docs/site/webhooks/${filename}`);
    if (didChange) changed++;
  }

  console.log(`\n✅ Catalogue generated: ${EVENT_REGISTRY.length} event types, ${changed} file(s) updated.`);
}

main();
