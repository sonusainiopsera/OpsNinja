# Database Grant Matrix

> **Source of truth:** `packages/db/src/schema/table-registry.ts`
> This document is auto-derived from the registry; keep both in sync.

## Roles

| Role | Type | Purpose |
|------|------|---------|
| `opsninja_migrator` | DDL / migration | Owns schema objects; used by drizzle-kit and DBA sessions. **Never** used by the API at runtime. Holds `CREATE` + `ALL` on schema `public`. |
| `opsninja_app` | Runtime canonical | Canonical name for the API runtime role. Alias of `app_user` (created by `0009_identity_rls.sql`). `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`. DML grants only; no `CREATE` on `public`. |
| `app_user` | Runtime (working name) | Same privilege level as `opsninja_app`. The API process connects as this role. DML grants applied by `0009_identity_rls.sql`. |

## Key Attributes (opsninja_app / app_user)

- `NOSUPERUSER` — cannot bypass PostgreSQL access controls
- `NOBYPASSRLS` — always subject to Row-Level Security (tenant isolation enforced unconditionally)
- `NOCREATEDB` — cannot create databases
- `NOCREATEROLE` — cannot create or drop roles
- `NOLOGIN` on `opsninja_app` (login via `app_user` in production)

## Grant Matrix

The table below shows the DML privileges granted to `app_user` / `opsninja_app`.  
Columns: `S` = SELECT, `I` = INSERT, `U` = UPDATE, `D` = DELETE.

`opsninja_migrator` holds `ALL PRIVILEGES` on all tables and is excluded from this matrix.

### Global / Reference Tables (no RLS)

| Table | S | I | U | D | Notes |
|-------|---|---|---|---|-------|
| `tenants` | ✓ | | | | Read-only for the API; tenant provisioning is out-of-band. |
| `roles` | ✓ | | | | Global RBAC catalog; read-only at runtime. |
| `permissions` | ✓ | | | | Global RBAC catalog. |
| `role_permissions` | ✓ | | | | Global RBAC join table. |

### Tenant-Scoped Tables

| Table | S | I | U | D | Notes |
|-------|---|---|---|---|-------|
| `organizations` | ✓ | ✓ | ✓ | | Soft-delete via `is_active`; no hard delete. |
| `organization_verified_domains` | ✓ | ✓ | ✓ | ✓ | Domains can be removed. |
| `custom_field_defs` | ✓ | ✓ | ✓ | ✓ | Admin-managed schema extensions. |
| `categories` | ✓ | ✓ | ✓ | ✓ | Ticket classification data. |
| `tickets` | ✓ | ✓ | ✓ | | Tickets are closed, not deleted (workflow state machine). |
| `ticket_comments` | ✓ | ✓ | ✓ | | Comments are auditable; soft-delete if needed. |
| `audit_logs` | ✓ | ✓ | | | **Append-only.** UPDATE and DELETE excluded and blocked by trigger. |
| `outbox_events` | ✓ | ✓ | ✓ | | UPDATE marks events dispatched; relay process may DELETE dispatched. |
| `users` | ✓ | ✓ | ✓ | | Soft-delete via `status`. |
| `customer_contacts` | ✓ | ✓ | ✓ | | CRM contacts. |
| `role_assignments` | ✓ | ✓ | ✓ | ✓ | Role grants are revocable. |
| `agent_org_scopes` | ✓ | ✓ | | ✓ | Scope grants; no in-place update (delete + insert). |
| `user_roles` | ✓ | ✓ | | ✓ | Role membership; no in-place update. |
| `refresh_sessions` | ✓ | ✓ | ✓ | | Revocation via UPDATE; TTL cleanup is out-of-band. |
| `email_verification_tokens` | ✓ | ✓ | ✓ | | Consumed via UPDATE. |
| `pending_user_approvals` | ✓ | ✓ | ✓ | ✓ | Approval flow; may be deleted once processed. |
| `ticket_ai_summaries` | ✓ | ✓ | ✓ | ✓ | AI synthesis; managed by background workers. |
| `ticket_affected_areas` | ✓ | ✓ | ✓ | ✓ | AI synthesis; dedup managed in application layer. |

## Row-Level Security Policy Summary

All tenant-scoped tables have:

```sql
ENABLE ROW LEVEL SECURITY
FORCE ROW LEVEL SECURITY

CREATE POLICY tenant_isolation ON <table>
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

**Fail-closed guarantee:** `current_setting('app.current_tenant', true)` returns `NULL` when unset. `NULL::uuid = NULL` evaluates to `NULL` (treated as `FALSE`) — zero rows returned instead of all rows.

### Portal Policies (RESTRICTIVE)

Additional `AS RESTRICTIVE` policies AND'd with `tenant_isolation`:

| Table | Policy | Condition |
|-------|--------|-----------|
| `tickets` | `portal_org_restriction` | Portal principal (`app.principal_kind = 'portal'`) can only see tickets where `organization_id = ANY(app_current_org_ids())` |
| `ticket_comments` | `portal_comment_restriction` | Portal principal can only see comments where `visibility = 'public'` |

`RESTRICTIVE` policies are AND'd with permissive ones. A row must satisfy ALL policies to be visible.

## Session Variable Protocol

All session variables must be set using `SET LOCAL` (transaction-scoped), not `SET` (session-scoped). This is required for PgBouncer transaction-mode pooling where connections are reused across client requests.

| Variable | Type | Purpose |
|----------|------|---------|
| `app.current_tenant` | `uuid` as text | Active tenant for all RLS policies |
| `app.principal_kind` | text (`'portal'` or `'staff'`) | Controls portal RESTRICTIVE policy activation |
| `app.current_org_ids` | comma-separated UUIDs | Allowed organization IDs for portal sessions |

## DDL Operations

`opsninja_migrator` is the only role authorized to:
- `ALTER TABLE`
- `DROP TABLE`
- `DISABLE ROW LEVEL SECURITY`
- `CREATE POLICY` / `DROP POLICY`

Long-running maintenance sessions **must** be documented in a runbook entry explaining why tenant scoping is intentionally bypassed for that operation.

## Test Assertions

`packages/db/test/rls-metadata.test.ts` asserts:
1. `pg_class.relrowsecurity = true` for every tenant-scoped table
2. `pg_class.relforcerowsecurity = true` for every tenant-scoped table
3. A `tenant_isolation` policy exists for every tenant-scoped table
4. Portal policies exist on `tickets` and `ticket_comments`
5. `information_schema.role_table_grants` matches this grant matrix for `app_user`
