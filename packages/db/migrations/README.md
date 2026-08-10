# OpsNinja Database Migrations

## Overview

Migrations are plain SQL files applied in numeric order by `drizzle-kit migrate`.
Every migration must follow **expand-and-contract** discipline:

| Rule | Rationale |
|---|---|
| No destructive DDL (`DROP TABLE`, `DROP COLUMN`, `ALTER … DROP`) in a migration that ships alongside code changes | Deployment is rolling; old code must still work against the new schema during the overlap window |
| Every new non-nullable column must have a `DEFAULT` value | Rows already in the table must get a valid value without a full-table rewrite |
| Schema changes and data backfills are separate migrations | A backfill on a large table can time out; isolating it prevents blocking the whole deployment |
| Add columns nullable first, then constrain in a later migration | Allows the previous application version to write rows without the new column |

## Migrations

### 0001_foundation.sql

Creates the full foundation schema for all core entities.

**Tables created:**

| Table | Scope | Notes |
|---|---|---|
| `tenants` | Global (not tenant-scoped) | Root entity; PK is `id` |
| `organizations` | Tenant-scoped | PK `(tenant_id, id)`; JSONB `custom_field_values` with GIN index |
| `organization_verified_domains` | Tenant-scoped | PK `(tenant_id, domain)`; per-tenant domain uniqueness |
| `custom_field_defs` | Tenant-scoped | PK `(tenant_id, id)`; UNIQUE `(tenant_id, key)` |
| `users` | Tenant-scoped | PK `(tenant_id, id)`; `kind` in `(staff, portal)` |
| `customer_contacts` | Tenant-scoped | PK `(tenant_id, id)`; composite FK to organizations |
| `role_assignments` | Tenant-scoped | PK `(tenant_id, user_id, role)`; `scope_version` bigint |
| `agent_org_scopes` | Tenant-scoped | PK `(tenant_id, user_id, organization_id)` |
| `categories` | Tenant-scoped | PK `(tenant_id, id)`; self-referencing parent_id; materialised path |
| `tickets` | Tenant-scoped, **partitioned** | PK `(tenant_id, id, created_at)`; monthly RANGE on `created_at` |
| `ticket_comments` | Tenant-scoped, **partitioned** | PK `(tenant_id, id, created_at)`; monthly RANGE on `created_at` |
| `audit_logs` | Tenant-scoped, **partitioned** | PK `(tenant_id, id, occurred_at)`; monthly RANGE on `occurred_at`; append-only |
| `outbox_events` | Tenant-scoped | PK `(tenant_id, id)`; transactional outbox pattern |
| `retention_policies` | Global | Data-driven config for the purge job |

**Functions created:**

- `ensure_monthly_partitions(table_name, months_ahead)` — idempotently creates N months of range partitions.

### 0005_outbox_backoff.sql

Additive migration for the outbox drain worker (WO-007).

**Changes:** Adds `outbox_seq` (bigint sequence for ordering tiebreaker), `next_attempt_at`, and `status` check constraint (`pending|published|dead_letter`) to `outbox_events`. Updates `retention_policies` minimum for `audit_logs` to 12 months. Confirms `REVOKE UPDATE, DELETE ON audit_logs FROM app_user`.

---

### 0009_identity_rls.sql

Identity persistence layer and Row-Level Security (WO-009).

**New tables:**

| Table | Scope | Notes |
|---|---|---|
| `roles` | Global | Canonical RBAC role catalog; no tenant_id; no RLS |
| `permissions` | Global | Permission codes in `resource:action` format |
| `role_permissions` | Global | Role→permission junction |
| `user_roles` | Tenant-scoped | Normalized FK to `roles`; RLS policy `tenant_isolation` |
| `refresh_sessions` | Tenant-scoped | Token stored as SHA-256; RLS applied |
| `email_verification_tokens` | Nullable tenant | Nullable `tenant_id` for pre-bind signups; special RLS |
| `pending_user_approvals` | Nullable tenant | Admin approval queue; nullable `tenant_id`; special RLS |

**Schema expansions to existing tables:**

- `users`: adds `email_normalized text` (unique index per tenant), `display_name text`, `user_type text CHECK (staff|portal|machine)`. The legacy `kind` column is retained.

**RLS policies:** `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` applied to all tenant-scoped tables (including tables from 0001). Policy predicate uses `app_current_tenant()` helper which:
- Returns `NULL` (fail-closed) when `app.current_tenant` is unset or empty.
- Returns `NULL` (fail-closed, no 500 error) when `app.current_tenant` is an invalid UUID string.

**Application role:** Creates `app_user` (NOSUPERUSER, NOBYPASSRLS, NOLOGIN) and grants minimum DML on all identity and supporting tables. The role never has BYPASSRLS even in development.

**Rollback story:** This migration is expand-only (no destructive DDL). Rolling back in production means:
1. Revert the application to the prior release (the `app_user` role and RLS policies are additive; old code ignores the new tables).
2. The `user_roles`, `refresh_sessions`, `email_verification_tokens`, and `pending_user_approvals` tables contain no data in a fresh deployment, so they can be dropped in a subsequent cleanup migration if the WO is fully reverted.
3. New columns on `users` (`email_normalized`, `display_name`, `user_type`) are nullable; old code that doesn't write them sees NULLs, which is safe.
4. RLS policies can be dropped without data loss (`DROP POLICY IF EXISTS tenant_isolation ON <table>`).

---

## Known FK Exceptions

### ticket_comments → tickets

PostgreSQL ≤16 does not support foreign key references **to** a partitioned table's composite primary key in all circumstances. Specifically, the `ticket_comments.ticket_id` column cannot carry a composite FK to `tickets(tenant_id, id, created_at)` because `created_at` is unknown at comment-insert time.

**Mitigation:** The `TicketService` validates the parent ticket's existence within the same tenant before inserting a comment. The RLS policy (WO-003) provides an additional database-level barrier because a comment for a non-existent ticket would still be confined to the correct tenant_id. This is documented and tracked; a future PostgreSQL release or partition attachment strategy may allow the full FK.

### Partition inheritance of app_user REVOKE

`REVOKE UPDATE, DELETE ON audit_logs FROM app_user` applies to the parent partitioned table. New monthly child partitions automatically inherit this restriction when created by `ensure_monthly_partitions()`. The `audit_logs_default` partition is explicitly revoked as well.

---

## Partition Management

The `ensure_monthly_partitions` function is called:

1. At the end of `0001_foundation.sql` to bootstrap the current month plus 3 months ahead.
2. By the SLA Timer Scheduler background job at the start of each month to pre-create the next partition.

To manually add partitions:

```sql
SELECT ensure_monthly_partitions('tickets', 6);
SELECT ensure_monthly_partitions('ticket_comments', 6);
SELECT ensure_monthly_partitions('audit_logs', 6);
```

Re-running this command for months that already have partitions is safe — the function silently skips existing ones.

---

## Running Migrations

```bash
# Apply all pending migrations
DATABASE_URL=postgres://user:pass@localhost:5432/opsninja \
  pnpm --filter @opsninja/db migrate

# Generate a new migration from schema changes
DATABASE_URL=postgres://user:pass@localhost:5432/opsninja \
  pnpm --filter @opsninja/db generate
```

For CI, the test harness in `packages/db/test/harness.ts` spins up a throwaway PostgreSQL 16 container and applies all migrations automatically.
