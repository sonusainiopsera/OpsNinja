# Isolation Testing Runbook

## Overview

OpsNinja enforces multi-tenant isolation at three layers:
1. **PostgreSQL RLS** — row-level policies keyed on `app.current_tenant`
2. **Org-scope filter** — agents see only their assigned organizations
3. **Portal visibility** — portal users see only `visibility='public'` comments

The isolation harness (`npm run test:isolation`) continuously proves all three layers. This runbook explains how to:
- Add a new tenant-scoped table without breaking the harness
- Add a new API route without breaking the harness
- Triage each class of harness failure
- Run the full harness locally

---

## Running the Harness

### Quick (offline, mocked DB)

```bash
# Runs isolation-contract.e2e-spec.ts and portal-isolation.e2e-spec.ts
npm run test:isolation -w @opsninja/api
```

### Full (requires Postgres 16)

```bash
# Start the test database
docker compose -f docker-compose.test.yml up -d

# Run all isolation tests including metadata and negative-privilege suites
ISOLATION_TEST_DB_URL=postgresql://opsninja_test:opsninja_test@localhost:5433/opsninja_test \
  npm run test:isolation
```

The `packages/db` metadata and negative-privilege suites skip automatically when
`ISOLATION_TEST_DB_URL` and `TEST_DATABASE_URL` are both unset.

---

## Adding a New Tenant-Scoped Table

Every new table that contains per-tenant data **must** be registered and protected.

### Step 1 — Write the migration

Your migration SQL must include:

```sql
CREATE TABLE my_new_table (
  id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL,       -- NON-NULLABLE
  ...
  PRIMARY KEY (id),
  -- tenant_id-LEADING index:
  CONSTRAINT my_new_table_tenant_idx ...
);
CREATE INDEX my_new_table_tenant_idx ON my_new_table(tenant_id, id);

ALTER TABLE my_new_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_new_table FORCE ROW LEVEL SECURITY;

CREATE POLICY my_new_table_tenant_isolation ON my_new_table
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

### Step 2 — Register the table

Add the table name to `TENANT_SCOPED_TABLES` in
`packages/db/test/isolation-metadata.test.ts`:

```typescript
const TENANT_SCOPED_TABLES: string[] = [
  // ... existing tables ...
  'my_new_table',
];
```

### Step 3 — Verify

Run the metadata suite to confirm all five controls are present:

```bash
ISOLATION_TEST_DB_URL=... jest packages/db/test/isolation-metadata.test.ts
```

### Registering a Global Table

If a table is intentionally **not** tenant-scoped (e.g. a global lookup table),
add it to `GLOBALLY_SCOPED_TABLES` with a justification:

```typescript
const GLOBALLY_SCOPED_TABLES: Record<string, string> = {
  // ... existing ...
  'event_types': 'Global lookup table; no tenant data stored; readable by all roles',
};
```

An unregistered table (in neither list) **fails the harness** — this is intentional.

---

## Adding a New API Route

### Step 1 — Declare permission metadata

Every `/api/v1` route **must** have `@RequirePermission(Permission.SOME_PERM)`.
The guard denies-by-default for routes with no metadata.

```typescript
@Get(':id')
@RequirePermission(Permission.TICKETS_READ)
async getTicket(@Param('id') id: string) { ... }
```

### Step 2 — Add route annotation (for contract suite)

If your route takes an `:id` parameter, the contract suite will attempt cross-tenant
access with a Tenant-B token. Ensure your handler returns 404 (not 403) for
out-of-scope IDs:

```typescript
const ticket = await this.ticketRepo.findById(id);
assertFound(ticket, 'Ticket');   // throws 404 for both missing and out-of-scope
```

### Step 3 — Add minimal body fixture (for mutating routes)

If your route requires a request body for cross-tenant 404 testing, add a
minimal valid body entry to the contract suite's `ROUTE_BODY_FIXTURES` map.

### Step 4 — Run the contract suite

```bash
npm run test:isolation -w @opsninja/api
```

---

## Triage Guide

### "Unregistered table" failure

```
Error: Unregistered tables found — add to TENANT_SCOPED_TABLES or GLOBALLY_SCOPED_TABLES:
  my_new_table
```

A new migration added a table that is not registered. See "Adding a New Tenant-Scoped Table" above.

### "missing a NOT NULL tenant_id column" failure

The migration forgot `NOT NULL` on `tenant_id`. Fix the migration SQL and re-run.

### "has no index starting with tenant_id" failure

Add `CREATE INDEX ... ON table(tenant_id, ...)` to the migration.

### "does not have ROW LEVEL SECURITY enabled/forced" failure

Add `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY` to the migration.

### "RLS policies missing coverage for: UPDATE, DELETE" failure

The policy uses `FOR SELECT` only. Switch to `FOR ALL` or add per-command policies.

### "Cross-tenant GET returned 200 — isolation leak!" failure

A route returned data for a resource belonging to another tenant. 
Check that the repository query includes a `tenant_id` predicate and that RLS is enabled.

### "Got 403 instead of 404 — existence disclosure!" failure

The handler is returning 403 for out-of-scope resources. Use `assertFound()` from
`apps/api/src/common/errors/not-found.ts` so both missing and out-of-scope produce 404.

### "Expected PG error 42501 but got..." failure (negative-privilege suite)

The runtime database role has been granted unexpected privileges. Review the role's
grants in the database and remove any DDL/bypass permissions.

### Metadata suite skipped

Set `ISOLATION_TEST_DB_URL` to a Postgres 16 test database:

```bash
ISOLATION_TEST_DB_URL=postgresql://opsninja_test:opsninja_test@localhost:5433/opsninja_test \
  npm run test:isolation -w @opsninja/db
```

---

## Regenerating Fixtures

The two-tenant fixture dataset is defined in
`apps/api/test/fixtures/tenant-factory.ts`. All identifiers are hardcoded UUIDs
derived from readable seeds — do **not** use random UUIDs.

When adding a new fixture (e.g. a new ticket or comment), append a new entry
with a UUID following the established `00000000-0000-000X-YYYY-00000000000Z`
pattern and update the `TenantDataset` type if adding a new entity type.

---

## Time Budget

The offline harness (no DB) should complete in under 30 seconds.
The full harness (with Postgres container) should complete in under 2 minutes.

If runtime grows beyond these budgets, parallelise suites by splitting
`jest-isolation.json` into separate config files and running them concurrently.
