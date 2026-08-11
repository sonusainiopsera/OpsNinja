# ADR: SLA Scheduler Cross-Tenant Claim vs RLS Pattern

**Status:** Accepted  
**Date:** 2026-08-11  
**Author:** Engineering (WO-046)

---

## Context

The SLA scheduler worker must poll `sla_timers` every 15 seconds and claim rows whose
`next_fire_at <= now()` using `FOR UPDATE SKIP LOCKED LIMIT 500`.  This claim batch spans
**all tenants** — a single SELECT returns rows belonging to many different tenants.

The rest of the application enforces tenant isolation by:
1. Setting `app.current_tenant` (a PostgreSQL session variable) to a single tenant UUID before
   every transaction.
2. Relying on the `tenant_isolation` RLS policy `USING (tenant_id::text = current_setting('app.current_tenant', true))`
   on every table.

These two mechanisms are in direct tension for the scheduler:

- A single `app.current_tenant` value blocks the cross-tenant claim query.
- Using `BYPASSRLS` or `SUPERUSER` on the scheduler role eliminates the RLS safety net entirely
  across **all** tables for any query that role issues, creating a broad privilege escalation surface.

---

## Decision

**Use a narrow claim role with a role-scoped policy.**

A dedicated PostgreSQL role `opsninja_sla_scheduler` is created with:
- `SELECT` and `UPDATE` on `sla_timers` only.
- `INSERT` on `outbox_events` only (needed for a fallback path; primary inserts happen via the
  per-tenant sub-transaction below).
- **No** `BYPASSRLS`, **no** `SUPERUSER`.

A second, **role-scoped** RLS policy is added to `sla_timers`:

```sql
CREATE POLICY scheduler_claim ON sla_timers
  FOR ALL
  TO opsninja_sla_scheduler
  USING (true);          -- cross-tenant read is permitted for this role
```

The `tenant_isolation` policy continues to apply to all other roles.  The combination means:

| Role | `tenant_isolation` applies | `scheduler_claim` applies | Net result |
|---|---|---|---|
| `opsninja_app` (normal HTTP) | Yes | No | Single-tenant, RLS-bound |
| `opsninja_sla_scheduler` | Yes (name doesn't match TO clause) | Yes | Cross-tenant claim permitted |

After the claim SELECT returns a batch of timer rows (each carrying `tenant_id`), the worker
opens a **per-timer, per-tenant sub-transaction** executed by the normal `opsninja_app` role
with `SET LOCAL app.current_tenant = '<timer.tenantId>'` before any side-effect:

```
BEGIN;                                           -- scheduler claim role
  SELECT ... FROM sla_timers ... FOR UPDATE SKIP LOCKED LIMIT 500;
  -- For each timer:
  --   switch to per-tenant sub-transaction (opsninja_app role)
  --   SET LOCAL app.current_tenant = timer.tenantId;
  --   validate ticket terminal state;
  --   INSERT INTO outbox_events ...;
  --   UPDATE sla_timers SET next_fire_at = ..., state = ... WHERE id = timer.id;
COMMIT;
```

Because `FOR UPDATE` locks are held inside the outer transaction, the worker can release each
lock immediately after advancing the timer, so cross-tenant batch processing does not hold
all locks to the end of the transaction.

---

## Consequences

**Positive:**
- No `BYPASSRLS` or superuser privilege anywhere in the scheduler path.
- The claim role's table permission is the least-privilege surface: only `sla_timers` and
  `outbox_events`; no access to `tickets`, `ticket_comments`, `users`, etc.
- All tenant-scoped side effects (outbox inserts, ticket state checks) run under the normal
  application role with `app.current_tenant` set, so the application-level RLS policies
  still protect those tables.
- A test asserting that a tenant-scoped read without `app.current_tenant` returns zero rows
  proves fail-closed behaviour (see `sla-scheduler.spec.ts` RLS test).

**Negative:**
- Two roles must be maintained in the migration and in Helm / Kubernetes secrets.
- The claim query cannot use Drizzle ORM (which relies on the tenant-transaction helper);
  it uses a raw `pg.PoolClient` from a dedicated connection pool configured with the claim
  role credentials.

**Rejected alternatives:**

| Alternative | Reason rejected |
|---|---|
| `BYPASSRLS` on the scheduler role | Eliminates RLS on ALL tables for queries issued by that role; catastrophic if the role is compromised or used inadvertently. |
| Single `app.current_tenant = ''` (empty string) | Would require all tables to treat empty string as a wildcard — undermines the RLS contract for every table. |
| Claim one tenant at a time | Requires 15s × N-tenants polling; does not scale and widens the SLO window for large tenant counts. |
| Application-level filtering without RLS | Defence-in-depth is lost; a bug in application code alone could leak cross-tenant data. |

---

## Test Verification

`apps/api/test/integration/sla-scheduler.spec.ts` includes an explicit test:

> **"RLS fail-closed: cross-tenant claim without scheduler role policy returns zero rows"**
>
> Temporarily drops the `scheduler_claim` policy, re-connects as `opsninja_app` with no
> `app.current_tenant` set, and asserts `SELECT * FROM sla_timers` returns 0 rows for Tenant B
> when the session variable is absent — proving the `tenant_isolation` policy is independently
> enforced and the `scheduler_claim` policy is the only mechanism that grants cross-tenant access.
