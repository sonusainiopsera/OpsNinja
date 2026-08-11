---
title: "Error Envelope and Distributed Tracing"
audience: "integration-developer"
last-reviewed: "2026-08-11"
---

# Error Envelope and Distributed Tracing

All OpsNinja API errors follow a uniform JSON envelope so that client code can handle errors
programmatically without parsing message strings.

## Error Envelope Shape

```json
{
  "error": {
    "code":    "TICKET_NOT_FOUND",
    "message": "Ticket 01910f2a-0000-7000-8000-000000000001 not found or inaccessible.",
    "traceId": "4b9c1e22-0000-4000-8000-000000000099",
    "details": [
      { "field": "ticketId", "issue": "not_found" }
    ]
  }
}
```

| Field     | Always present | Description                                                                 |
|-----------|----------------|-----------------------------------------------------------------------------|
| `code`    | Yes            | Machine-readable error code. Stable across releases; safe to switch on.    |
| `message` | Yes            | Human-readable description. **Do not parse** — may change across releases. |
| `traceId` | Yes            | Distributed trace ID for support investigations.                            |
| `details` | No             | Per-field validation errors or additional context.                          |

## HTTP Status to Error Code Mapping

| HTTP | Codes (examples)                                                       | Meaning                                        |
|------|------------------------------------------------------------------------|------------------------------------------------|
| 400  | `VALIDATION_ERROR`, `INVALID_FILTER_AST`                               | Client sent malformed input.                   |
| 401  | `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_EXPIRED`, `AUTH_REAUTHORIZE_REQUIRED`| Authentication required or stale.              |
| 403  | `PERMISSION_DENIED`                                                    | Authenticated but not authorized.              |
| 404  | `TICKET_NOT_FOUND`, `REPORT_NOT_FOUND`                                 | Resource absent or out of scope (indistinct).  |
| 409  | `DUPLICATE_IDEMPOTENCY_KEY`                                            | Conflicting write with same idempotency key.   |
| 422  | `EXPORT_FORMAT_ROW_LIMIT`, `ORG_SCOPE_INVALID_ORGANIZATION`            | Semantically invalid request.                  |
| 429  | `AUTH_RATE_LIMITED`                                                    | Rate limit exceeded (see `Retry-After`).       |
| 503  | `REPLICA_UNAVAILABLE`, `DEPENDENCY_UNAVAILABLE`                        | Transient backend condition; retry with delay. |

### 404 vs 403 for Out-of-Scope Resources

Resources that exist but are outside your organisation scope return **404**, not 403. This
prevents existence disclosure: a caller cannot distinguish "does not exist" from "exists but
you cannot see it." Never assume a 404 means the resource is permanently gone — it may become
visible if your scope changes.

## Using the traceId

Include the `traceId` in all support requests. Engineers can correlate it with backend logs,
database query spans, and any downstream service calls within the same request.

The `traceId` is a UUID. It is emitted by the API regardless of error type, including 5xx errors.
For 5xx errors the `traceId` is the only useful field — the `message` is deliberately generic to
avoid exposing internal details.

## Validation Error Details

For `VALIDATION_ERROR` (HTTP 400), `details` is an array of field-level issues:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "traceId": "...",
    "details": [
      { "field": "priority",      "issue": "must be one of P1, P2, P3, P4" },
      { "field": "subject",       "issue": "required" },
      { "field": "organizationId","issue": "must be a valid UUID" }
    ]
  }
}
```

`field` paths use dot notation for nested objects (`data.address.postcode`).

## Retryable vs Terminal Errors

Retry only on transient conditions:

| Should retry | Codes / HTTP                                                      |
|--------------|-------------------------------------------------------------------|
| Yes          | HTTP 429 (after `Retry-After`), HTTP 503, HTTP 502, HTTP 504      |
| No           | HTTP 400, 401, 403, 404, 409, 422; any error with a stable `code` |

5xx errors without a structured `code` in the body are transient infrastructure errors — retry
with exponential backoff and a maximum of 3 attempts.

## Distributed Trace Propagation

Outbound webhook delivery requests carry the originating trace via the `X-OpsNinja-Trace-Id`
header. Your endpoint can log this to correlate inbound webhook events with the API-side
operation that triggered them.
