---
title: "Pagination, Rate Limits, and Retry-After"
audience: "integration-developer"
last-reviewed: "2026-08-11"
---

# Pagination, Rate Limits, and Retry-After

## Cursor Pagination

All list endpoints that return more than one page of results use **cursor-based pagination**.
Offset pagination (`?page=3`) is not supported because it produces inconsistent results under
concurrent writes.

### Request

```
GET /api/v1/tickets?limit=50&after=<cursor>
```

| Parameter | Type   | Default | Description                                        |
|-----------|--------|---------|----------------------------------------------------|
| `limit`   | int    | 25      | Number of items per page. Maximum: 200.            |
| `after`   | string | —       | Opaque cursor returned by the previous page.       |
| `before`  | string | —       | Fetch the page preceding this cursor.              |

### Response

```json
{
  "data": [ ... ],
  "pagination": {
    "hasNextPage": true,
    "hasPreviousPage": false,
    "nextCursor": "eyJpZCI6IjAxOTEifQ",
    "previousCursor": null,
    "totalCount": 1842
  }
}
```

Cursors are opaque base64-encoded strings. Do not parse, store persistently, or share cursors
across tenants — they are valid only within the issuing tenant context and expire after **1 hour**.

`totalCount` is a best-effort estimate for large result sets (>10,000 rows). Use `hasNextPage` for
reliable termination detection.

### Stable Ordering

List results are ordered by `created_at DESC, id DESC` by default. Specifying `sort` overrides
the primary sort key but `id DESC` is always appended as a tiebreaker. This guarantees consistent
cursor positioning even when two records share the same `created_at`.

## Rate Limits

OpsNinja enforces per-tenant, per-principal rate limits. Limits are applied to the sliding window
of the past 60 seconds.

| Endpoint group             | Requests / 60s | Burst      |
|----------------------------|----------------|------------|
| General API (`/api/v1/*`)  | 1,000          | 1,200      |
| Auth endpoints (`/auth/*`) | 20             | 25         |
| Webhook test-fire          | 10             | 10         |
| Report export requests     | 5              | 5          |

Rate-limited responses carry `HTTP 429 Too Many Requests` with:

```
Retry-After: 12
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700001200
```

`Retry-After` is in **seconds**. `X-RateLimit-Reset` is a Unix timestamp. Clients must honour
`Retry-After` before retrying — exponential backoff with full jitter is recommended for automated
integrations.

WAF-level rate limits are applied before requests reach the API:

| Path pattern           | Requests / 5 min | Action    |
|------------------------|------------------|-----------|
| `/api/v1/auth/*`       | 2,000 per IP     | 429 block |
| `/api/v1/portal/signup`| 2,000 per IP     | 429 block |

## Idempotency

Write operations (`POST`, `PATCH`, `DELETE`) accept an optional `Idempotency-Key` header. Requests
with the same key within a **24-hour window** return the cached response without re-executing the
operation.

```
Idempotency-Key: a3f8b2c1-0000-4000-8000-000000000001
```

See [Idempotency and Retries](./idempotency-and-retries.md) for full guidance.

## Handling 503 and Replica Lag

Report-related endpoints (`/api/v1/reports/*`) read from the reporting read replica. If the
replica is too far behind the primary, these endpoints return:

```json
{ "error": { "code": "REPLICA_UNAVAILABLE", "message": "..." } }
```

with `HTTP 503`. Retry with exponential backoff; this condition is transient.
