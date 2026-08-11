---
title: "Outbound Webhooks"
audience: "integration-developer"
last-reviewed: "2026-08-11"
---

# Outbound Webhooks

OpsNinja delivers outbound webhook events for all significant state changes via HTTPS POST to
your registered endpoints. Events originate from the transactional outbox, so they are emitted
if and only if the underlying database state change committed — there are no phantom events.

## Event Envelope

Every webhook request body is a canonical JSON object:

```json
{
  "id":          "01910f2a-0000-7000-8000-000000000042",
  "type":        "ticket.created",
  "occurredAt":  "2026-01-15T10:00:00.000Z",
  "tenantId":    "00000000-0000-0000-0000-000000000001",
  "data": {
    "id":             "01910f2a-0000-7000-8000-000000000001",
    "subject":        "Cannot connect to VPN",
    "status":         "open",
    "priority":       "P2",
    "organizationId": "01910f2a-0000-7000-8000-000000000002",
    "createdAt":      "2026-01-15T10:00:00.000Z"
  }
}
```

| Field       | Type   | Description                                                  |
|-------------|--------|--------------------------------------------------------------|
| `id`        | UUID   | Unique event identifier. Use as idempotency key.             |
| `type`      | string | Dot-namespaced event type from the webhook catalogue.         |
| `occurredAt`| string | ISO 8601 UTC timestamp of when the business event occurred.  |
| `tenantId`  | UUID   | Your tenant identifier.                                      |
| `data`      | object | Event-type-specific payload (see catalogue for each schema). |

Keys in the envelope and in `data` are **sorted alphabetically** for deterministic signing.
Do not assume insertion order when parsing.

## Request Headers

| Header                   | Example                                 | Description                                                        |
|--------------------------|-----------------------------------------|--------------------------------------------------------------------|
| `Content-Type`           | `application/json`                      | Always `application/json`.                                         |
| `X-OpsNinja-Event-Id`    | `01910f2a-0000-7000-8000-000000000042`  | Same as `id` in the body. Available before parsing the body.       |
| `X-OpsNinja-Event-Type`  | `ticket.created`                        | Same as `type` in the body.                                        |
| `X-OpsNinja-Timestamp`   | `1705312800`                            | Unix seconds used for signing.                                     |
| `X-OpsNinja-Signature`   | `t=1705312800,v1=abc123...`             | HMAC-SHA-256 signature (see [Signature Verification](#signature-verification)). |
| `X-OpsNinja-Trace-Id`    | `4b9c1e22-0000-4000-8000-000000000099`  | Distributed trace ID for correlating with API-side operations.     |
| `User-Agent`             | `OpsNinja-Webhook/1.0`                  | Identifies the delivery agent.                                     |

## Signature Verification

Every delivery is signed with HMAC-SHA-256 using your endpoint's signing secret.

### Header Format

```
X-OpsNinja-Signature: t=<unixSeconds>,v1=<hexDigest>
```

During secret rotation, a second `v1=` component is appended for the previous secret:

```
X-OpsNinja-Signature: t=<unixSeconds>,v1=<currentDigest>,v1=<previousDigest>
```

### Signed Payload Construction

The signed bytes are the concatenation of the timestamp and the **raw request body**:

```
<unixSeconds>.<rawBody>
```

where `<rawBody>` is the exact bytes received — do not parse and re-serialize before verifying.

### Verification Steps

**Step 1.** Extract the `t=` component and all `v1=` components from the header.

**Step 2.** Reject requests where `|now - t| > 300` seconds (5-minute replay window). Account for
reasonable clock skew (≤30 seconds) if your system clock may drift.

**Step 3.** Compute `HMAC-SHA-256(secret, "<t>.<rawBody>")` where `<t>` is the string value from
the header, not an integer.

**Step 4.** Use a **timing-safe comparison** to compare your computed digest against each `v1=`
value. Accept if any `v1=` matches.

**Step 5.** If no `v1=` matches, reject the request with `HTTP 401` and log for investigation.

### Verification Example (Node.js)

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(rawBody, header, secret) {
  const parts = header.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
  const v1Values = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));

  if (!timestamp || v1Values.length === 0) return false;

  // Replay window check (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  // Compute expected HMAC
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');

  // Timing-safe comparison
  return v1Values.some(v1 => {
    if (v1.length !== 64) return false;
    try {
      return crypto.timingSafeEqual(expectedBuf, Buffer.from(v1, 'hex'));
    } catch { return false; }
  });
}
```

### Verification Example (Python)

```python
import hashlib
import hmac
import time

def verify_webhook_signature(raw_body: bytes, header: str, secret: str) -> bool:
    parts = header.split(',')
    timestamp = next((p[2:] for p in parts if p.startswith('t=')), None)
    v1_values = [p[3:] for p in parts if p.startswith('v1=')]

    if not timestamp or not v1_values:
        return False

    # Replay window check (5 minutes)
    if abs(time.time() - int(timestamp)) > 300:
        return False

    # Compute expected HMAC
    payload = f"{timestamp}.".encode() + raw_body
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    expected_bytes = bytes.fromhex(expected)

    # Timing-safe comparison
    return any(
        hmac.compare_digest(expected_bytes, bytes.fromhex(v1))
        for v1 in v1_values
        if len(v1) == 64
    )
```

Replace `YOUR_WEBHOOK_SECRET` with the plaintext secret from your endpoint's configuration.
Never log or expose the secret.

## Delivery Guarantees

- **At-least-once**: Events may be delivered more than once. Use the `id` field as your
  idempotency key to deduplicate.
- **No ordering guarantee across event types**: A `ticket.updated` event may arrive before
  `ticket.created` for the same ticket if they were enqueued in a burst. Use `occurredAt` for
  sequencing.
- **Per-ticket ordering**: Events for the same ticket are enqueued in occurrence order. Delivery
  order matches enqueue order under normal conditions, but retries may cause re-ordering.

## Retry Schedule {#retry-schedule}

Non-2xx responses and connection errors trigger automatic retries with exponential backoff:

| Attempt | Delay before retry |
|---------|--------------------|
| 1       | Immediate          |
| 2       | 1 second           |
| 3       | 2 seconds          |
| 4       | 4 seconds          |
| 5       | 8 seconds          |
| 6       | 60 seconds         |

After **6 attempts** without a 2xx response, the event is routed to the dead-letter queue and an
operator alert fires. You can request a replay via `POST /api/v1/webhooks/endpoints/:id/replay`.

Your endpoint must respond **within 30 seconds**. Timeout counts as a failure and triggers a retry.

## Responding to Duplicate Deliveries

Always respond `2xx` promptly, even for events you have already processed. A `4xx` response is
treated as a permanent failure (no retry). A `5xx` response triggers a retry.

Recommended duplicate handling pattern:

1. Persist the `id` field to a deduplication table on first receipt.
2. On subsequent receipts, look up the `id` and return `200` immediately.
3. Process the event asynchronously after acknowledging receipt.

## Confidential-Tier Fields

Some events may contain `confidential`-tier data (see the catalogue entry for each event type).
Fields marked `[redacted]` in the payload schema are omitted for portal-visible subscriptions and
replaced with a placeholder string. Agent-facing subscriptions receive the full payload.

## Large Payloads

Payloads above the documented size limit reference the full resource by ID rather than embedding
it inline. Fetch the resource via the REST API using the `id` in the `data` object.

## Clock Skew

The 5-minute replay window accounts for reasonable consumer clock drift. We recommend:

- Sync your consumer clocks via NTP or a cloud time service.
- If your clock may drift more than 30 seconds, contact support to discuss extended window options.
