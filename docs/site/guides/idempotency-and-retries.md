---
title: "Idempotency for Write Operations"
audience: "integration-developer"
last-reviewed: "2026-08-11"
---

# Idempotency for Write Operations

Network failures, timeouts, and service restarts can cause a request to be lost in transit or
a response to be lost on the way back. Without idempotency, a naive retry creates duplicate
resources. OpsNinja implements server-side idempotency for all mutating operations.

## The Idempotency-Key Header

Include a client-generated `Idempotency-Key` header in any `POST`, `PATCH`, or `DELETE` request
you may need to retry:

```
POST /api/v1/tickets
Idempotency-Key: 3fa85f64-5717-4562-b3fc-2c963f66afa6
Content-Type: application/json
```

The key must be a UUID v4 or any string up to 255 characters that is unique per **logical
operation** within your tenant. Use a key derived from your own transaction ID or request ID —
never reuse a key for a different operation.

### Response Caching Window

Keys are de-duplicated for **24 hours** from the first successful response. Within that window:

- A request with the same key returns the cached HTTP status and body instantly.
- A request with the same key but a **different body** returns `HTTP 409 DUPLICATE_IDEMPOTENCY_KEY`.

After 24 hours, the key expires and a new request with the same key is treated as fresh.

### In-Flight Requests

If two identical requests arrive simultaneously (same key, both in-flight), the second request
waits up to **5 seconds** for the first to complete, then returns `HTTP 409 CONCURRENT_REQUEST`.
Retry the second request after the first resolves.

## Webhook Delivery Idempotency

Outbound webhook events are delivered **at-least-once** — your endpoint may receive the same
event multiple times. The recommended idempotency key for consumers is the `id` field in the
canonical event envelope:

```json
{ "id": "01910f2a-0000-7000-8000-000000000042", "type": "ticket.created", ... }
```

Store processed event IDs and skip events you have already handled. The `id` is a stable UUID
generated at event creation time and never changes across retries.

For the delivery retry schedule and backoff intervals, see
[Webhooks: Retry Schedule](./webhooks/index.md#retry-schedule).

## Duplicate Delivery After Consumer Outage

If your endpoint is unavailable for an extended period:

1. OpsNinja retries up to **6 attempts** using the documented backoff schedule.
2. After exhaustion, the event is routed to the dead-letter queue and an operator alert fires.
3. You can request a replay of missed events for a specific time window via:
   `POST /api/v1/webhooks/endpoints/:id/replay` — requires `webhook:manage` permission.

Replay re-delivers events in original occurrence order. Apply idempotency on `id` as described
above to handle events that may have been delivered before the outage.

## Retries for Non-Idempotent State

`GET` and `HEAD` requests are always safe to retry without side effects.

For `PATCH` and `DELETE` requests with an idempotency key, retrying is safe and returns the same
response as the first successful call.

For `POST` without an idempotency key, retrying may create a duplicate — always supply a key for
create operations that must be exactly-once.

## Idempotency and Transactions

Idempotency is enforced at the transaction level, not the HTTP layer. If a request succeeds at
the database level but the HTTP response is lost (connection reset), the same key on retry
returns the stored result, not a new execution. This is safe for all mutation types.

If you receive `HTTP 503` or a network timeout with no response body, assume the operation
**may or may not** have succeeded. Retry with the same idempotency key to get a definitive answer.
