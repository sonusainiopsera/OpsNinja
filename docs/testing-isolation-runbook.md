# Isolation Test Harness Runbook

## Overview

The isolation harness continuously proves tenant and organization isolation across every table and every registered route. It runs as a required CI check (`test:isolation`) and must pass green before any branch merges to main.

**Runtime budget:** ≤ 120 seconds for the full harness.

---

## Running the harness locally

```bash
# Start test infrastructure (Postgres 16 + Redis)
docker compose -f docker-compose.test.yml up -d

# Run the full isolation harness (API + DB suites)
DATABASE_URL=postgresql://opsninja_test:test_password@localhost:5433/opsninja_test \
  npm run test:isolation

# Run only the metadata + privilege suites (packages/db)
DATABASE_URL=... npm run test:isolation -w @opsninja/db

# Run only the contract + portal suites (apps/api)
DATABASE_URL=... npm run test:isolation -w @opsninja/api
```

---

## Adding a new tenant-scoped table

1. **Create the table** with:
   - `tenant_id UUID NOT NULL REFERENCES tenants(id)`
   - `CREATE INDEX ... ON table (tenant_id, ...)` — tenant_id must be the leading column
   - `ALTER TABLE table ENABLE ROW LEVEL SECURITY`
   - `ALTER TABLE table FORCE ROW LEVEL SECURITY`
   - `CREATE POLICY tenant_isolation ON table USING (tenant_id::text = current_setting('app.current_tenant', true))`

2. **Register the table** in `packages/db/test/isolation-metadata.test.ts`:
   ```typescript
   const TENANT_SCOPED_TABLES: string[] = [
     // ... existing tables ...
     'your_new_table',
   ];
   ```

3. **If the table is intentionally global** (no per-row tenant_id), add it to `GLOBAL_TABLES` with a justification:
   ```typescript
   const GLOBAL_TABLES: Record<string, string> = {
     your_global_table: 'Reason: shared configuration table, no tenant data',
   };
   ```

4. **Run the metadata suite** to confirm the new table passes all checks:
   ```bash
   DATABASE_URL=... npx jest packages/db/test/isolation-metadata
   ```

---

## Adding a new /api/v1 route

1. **Declare permissions** on every handler with `@RequirePermissions(...)`. Routes without a declaration are denied by default (AUTHZ_PERMISSION_DENIED) — this is an intentional fail-closed design, not a bug.

2. **Annotate the route** in `apps/api/test/isolation-contract.e2e-spec.ts`:
   - **ID-taking routes**: add an `IdRouteAnnotation` entry with a cross-tenant ID from the fixture set.
   - **List routes**: add a `ListRouteAnnotation` entry.
   - **Exempt routes** (health probes, auth callbacks): add an `ExemptAnnotation` with a reason.

3. **Run the contract suite** to verify the new route is correctly isolated:
   ```bash
   DATABASE_URL=... npx jest apps/api/test/isolation-contract
   ```

---

## Regenerating fixtures

The two-tenant harness uses deterministic UUIDs defined in `apps/api/test/fixtures/tenant-factory.ts`. **Do not change these UUIDs** — changing them breaks reproducibility and may cause CI failures on branches that reference specific IDs.

To add new entities to the fixture graph, add rows in `seedHarnessData()` using new UUIDs in the `f000xxxx-...` range and export the constants.

To update tokens (e.g. after adding new claims), edit `apps/api/test/fixtures/principals.ts`. Tokens are minted at module load time using the test RSA key pair.

---

## Triaging harness failures

| Failure type | Symptom | Fix |
|---|---|---|
| **Metadata: tenant_id missing** | `Table 'X' has no non-nullable tenant_id` | Add `tenant_id UUID NOT NULL` to the migration |
| **Metadata: no RLS** | `Table 'X' has RLS disabled` | Add `ENABLE/FORCE ROW LEVEL SECURITY` in migration |
| **Metadata: no policy** | `Table 'X' has no tenant_isolation policy` | Add `CREATE POLICY tenant_isolation ON X USING (...)` |
| **Metadata: unregistered table** | `Unregistered tables detected: [X]` | Add X to `TENANT_SCOPED_TABLES` or `GLOBAL_TABLES` |
| **Contract: 200 instead of 404** | `GET /api/v1/X/:id returned 200 for cross-tenant ID` | Apply `maskNotFound()` and `withOrgScope()` in the detail handler |
| **Contract: 403 instead of 404** | `GET /api/v1/X/:id returned 403 for cross-tenant ID` | Use `maskNotFound()` — out-of-scope must return 404, not 403 |
| **Portal: internal comment visible** | `Portal principal saw internal comment` | Ensure `portalCommentPredicate` is applied — checks visibility='public' |
| **Privilege: DDL succeeded** | `ALTER TABLE X succeeded as app role` | The app DB role has too many privileges — revoke DDL grants |
| **Setup: container startup** | `ECONNREFUSED 5432` | Start docker compose: `docker compose -f docker-compose.test.yml up -d` |

---

## Scope predicate checklist

Every list query in a repository must call `buildOrgScopePredicate()` or use the portal-specific `portalTicketPredicate()`. The harness will detect violations at the list-route contract level. Use this checklist when writing a new repository method:

- [ ] Call `getPrincipalContext()` at the start of the method
- [ ] Call `buildOrgScopePredicate(principal, table.organizationId)` — never skip this
- [ ] If predicate is `null` (admin/lead_analyst), no WHERE clause is needed
- [ ] If predicate is non-null, always apply it via `.where(predicate)`
- [ ] For detail handlers, call `maskNotFound(result, 'resource-type')` after the query
