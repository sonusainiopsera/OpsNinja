# OpsNinja Domain Event Catalogue

## Delivery Semantics

**At-least-once.** The outbox drain loop delivers events to consumers at least once. Consumers **must** be idempotent and use the event `id` field as their deduplication key.

The event `id` is a stable UUID assigned at the time the `outbox_events` row is inserted (same transaction as the business write). If the drain loop republishes a row (e.g., after a crash between publish and `published_at` acknowledgement), the `id` is identical, so idempotent consumers can detect and discard the duplicate.

## Event Envelope

All events share a common envelope structure:

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "aggregateType": "ticket",
  "aggregateId": "uuid",
  "eventType": "ticket.created",
  "payload": { ... },
  "occurredAt": "2025-06-01T12:00:00.000Z"
}
```

| Field           | Type      | Description                                                           |
|----------------|-----------|-----------------------------------------------------------------------|
| `id`           | UUID      | Stable deduplication key. Identical for republished events.          |
| `tenantId`     | UUID      | Owning tenant. Consumers must scope their actions to this tenant.    |
| `aggregateType`| string    | Domain entity type, e.g. `ticket`, `organization`, `comment`.        |
| `aggregateId`  | UUID      | UUID of the specific entity instance.                                |
| `eventType`    | string    | Domain event name. See catalogue below.                              |
| `payload`      | object    | Event-specific data. Schema documented per event type below.         |
| `occurredAt`   | ISO 8601  | Wall-clock time the event was created (not published).               |

---

## Event Types

### `ticket.created`

Emitted when a new ticket is created (via portal form, agent workspace, or email intake).

**Consumers:** SLA Timer Scheduler (create sla_timers row), Jira Sync Worker (if Jira integration is active), Notification Worker (notify assignee).

**Payload:**
```json
{
  "priority": "P1",
  "status": "open",
  "organizationId": "uuid",
  "categoryId": "uuid | null",
  "assigneeUserId": "uuid | null",
  "requesterContactId": "uuid | null"
}
```

---

### `ticket.updated`

Emitted when a ticket's mutable fields change (status, priority, assignee, category).

**Consumers:** SLA Timer Scheduler (recalculate timer on priority change), Jira Sync Worker, Notification Worker (notify on status change).

**Payload:**
```json
{
  "changedFields": ["status", "priority"],
  "previousStatus": "open",
  "newStatus": "solved",
  "previousPriority": "P2",
  "newPriority": "P1"
}
```

---

### `ticket.resolved`

Emitted when a ticket transitions to `solved` status. Triggers AI synthesis.

**Consumers:** AI Synthesis Worker (generate crux summary and affected-area tags), Notification Worker (trigger CSAT survey email).

**Payload:**
```json
{
  "resolvedByUserId": "uuid",
  "organizationId": "uuid"
}
```

---

### `ticket.closed`

Emitted when a ticket transitions to `closed` status.

**Consumers:** SLA Timer Scheduler (mark sla_timers as completed), Notification Worker.

**Payload:**
```json
{
  "closedByUserId": "uuid"
}
```

---

### `comment.added`

Emitted when a comment is added to a ticket.

**Consumers:** Notification Worker (notify requester on public reply), Jira Sync Worker (sync comment to Jira issue).

**Payload:**
```json
{
  "ticketId": "uuid",
  "visibility": "public | internal",
  "authorUserId": "uuid"
}
```

Note: comment `body` is classified Confidential and is NOT included in the event payload. Consumers that need the body must query the `ticket_comments` table directly with appropriate authorisation.

---

### `organization.created`

Emitted when a new organization is registered.

**Consumers:** Notification Worker (welcome email to the first contact, if any).

**Payload:**
```json
{
  "organizationId": "uuid",
  "name": "[REDACTED]",
  "tier": "standard"
}
```

Note: organisation `name` is redacted in the event payload per the Confidential classification; the canonical value is in the `organizations` table.

---

### `organization.deactivated`

Emitted when `organizations.is_active` is set to `false`.

**Consumers:** Notification Worker (alert assigned agents), Jira Sync Worker (suspend sync for the organisation).

**Payload:**
```json
{
  "organizationId": "uuid"
}
```

---

### `user.role_changed`

Emitted when a user's role assignment changes (role added or removed, or `scope_version` bumped).

**Consumers:** Auth Service (invalidate cached scope version in Redis).

**Payload:**
```json
{
  "userId": "uuid",
  "role": "agent",
  "action": "assigned | revoked",
  "newScopeVersion": 5
}
```

---

## Dead-letter Events

Events that exceed the maximum retry attempts (`MAX_ATTEMPTS = 6`) are flagged as `dead_letter` in `outbox_events.status`. Dead-lettered events:

- Are excluded from the drain loop.
- Emit an `error`-level structured log with `"alert": true`.
- Increment the `outbox_dead_letter_count` metric.
- Can be replayed by an operator using the drain service's `replay(eventId)` method.

**Alert threshold:** Any `dead_letter` count > 0 should trigger a P2 alert.

---

## Backoff Schedule

| Attempt | Delay   |
|---------|---------|
| 1       | 1 s     |
| 2       | 2 s     |
| 3       | 4 s     |
| 4       | 8 s     |
| 5       | 60 s    |
| 6       | 900 s   |
| 7+      | dead_letter |

---

## Observability

The drain worker exposes the following metrics (via `/metrics` HTTP endpoint):

| Metric                              | Type    | Alert threshold                    |
|-------------------------------------|---------|-------------------------------------|
| `outboxPendingCount`                | Gauge   | > 1000 for 5 min → P2               |
| `outboxOldestUnpublishedSeconds`    | Gauge   | > 300 for 5 min → P1                |
| `outboxDeadLetterCount`             | Gauge   | > 0 → P2                            |
| `publishSuccessTotal`               | Counter | —                                   |
| `publishFailureTotal`               | Counter | > 100/min sustained → P2            |
| `drainIterationsTotal`              | Counter | 0 for 30 s (stall detected) → P1    |
| `lastDrainDurationMs`               | Gauge   | > 4000 ms → warning                 |

A heartbeat structured log line is emitted every 30 seconds. A stalled drain loop is detectable by the absence of these logs.
