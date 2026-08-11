# Forge Implementation Log

| Field | Value |
|-------|-------|
| Project | a8d3a2cc-9c7c-42ac-b5d5-e5f3c0f68a4f |
| Branch | forge/opsninja-d3d5df73-run9-101wo |
| Started | 2026-08-10T23:08:21Z |

---

## WO-002: User Story: WO-002 - Define Tenant-Scoped Core Schema and Migrations
- **Status:** completed
- **Commit:** `39d7dd7`
- **Files:** 28 (+2802/-0)
- **Duration:** 924ss
- **Approach:** Created the @opsninja/db pnpm workspace package with Drizzle ORM schema modules split by domain (tenants, organizations, identity, categories, tickets, audit, outbox), a comprehensive SQL migration 0001_foundation.sql that applies all DDL including composite PKs, composite tenant-inclusive foreign keys, monthly range partitions for tickets/ticket_comments/audit_logs, the ensure_monthly_partitions() plpgsql helper, GIN index on custom_field_values JSONB, and partial unique indexes for category sibling uniqueness. The monorepo root was scaffolded with package.json (pnpm workspaces), tsconfig.base.json, pnpm-workspace.yaml, and a comprehensive .gitignore. Three test suites cover schema invariants (metadata-driven tenant_id design rule), integration constraints (composite FK rejection, partition routing, GIN EXPLAIN, check constraints), and unit-level column/type assertions without a live database.

## WO-007: User Story: WO-007 - Build Transactional Outbox and Immutable Audit Trail
- **Status:** completed
- **Commit:** `3fc9f95`
- **Files:** 38 (+2981/-6)
- **Duration:** 1241ss
- **Approach:** Implemented the transactional outbox and immutable audit trail as three integrated layers. (1) DB: migration 0005 adds outbox_seq monotonic tiebreaker column, next_attempt_at backoff column, and status check constraint (pending|published|dead_letter) to outbox_events, plus the partial drain index and 12-month audit retention enforcement. (2) Shared library (packages/shared): PII redaction policy with Confidential (→[REDACTED]) and Restricted (→SHA-256 hash) field classifications, PublisherPort interface, and three adapters (InMemoryPublisher, LoggingPublisher, FailingPublisher). (3) API common layer: AsyncLocalStorage-based TransactionContext propagating the active transaction handle, DomainEventRecorder with recordAudit()/enqueueEvent()/record() that throw TenantContextMissingError outside a transaction scope, and an audit diff builder with per-resource allow-lists and size capping. (4) Worker outbox: standalone DrainService with 500ms interval, batch-200 FOR UPDATE SKIP LOCKED loop, per-aggregate ordering by (created_at, outbox_seq), exponential backoff (1/2/4/8/60/900s), dead-letter transition at MAX_ATTEMPTS=6, operator replay command, in-process metrics, /healthz + /readyz + /metrics endpoints, and graceful SIGTERM/SIGINT shutdown.

## WO-009: User Story: WO-009 - Identity data model, migrations and RLS policies
- **Status:** completed
- **Commit:** `7c3e463`
- **Files:** 16 (+1645/-9)
- **Duration:** 878ss
- **Approach:** Implemented the identity persistence layer in three layers. (1) Migration 0009: creates the app_current_tenant() helper function that safely casts the session variable to UUID, failing closed (NULL) when unset, empty, or invalid. Expands the existing users table with email_normalized, display_name, user_type columns (expand-only). Creates seven new tables: roles, permissions, role_permissions (global catalog, no RLS), user_roles, refresh_sessions (tenant-scoped, full RLS), email_verification_tokens, pending_user_approvals (nullable tenant_id, permissive RLS for pre-bind signup flow). Creates the app_user database role (NOSUPERUSER, NOBYPASSRLS, NOLOGIN) with minimum DML grants. Applies ENABLE + FORCE ROW LEVEL SECURITY to all 16 tenant-scoped tables (including those from migration 0001). (2) Drizzle schema: rbac.ts and sessions.ts modules, identity.ts expanded. (3) Shared package: 30-permission TypeScript const union, ROLE_PERMISSIONS matrix for all 6 canonical roles, roleHasPermission() and resolvePermissions() helpers, unit tests. Seed script installs roles/permissions/role_permissions idempotently via ON CONFLICT DO NOTHING. Test fixtures load 2 tenants, 7 users spanning all roles, 3 agent org scopes. Integration tests cover all required RLS cases using SET LOCAL ROLE app_user within superuser transactions.

## WO-017: User Story: WO-017 - Establish Semantic Design Tokens and Dual Theme Engine
- **Status:** completed
- **Commit:** `dc292df`
- **Files:** 39 (+1989/-1)
- **Duration:** 1123ss
- **Approach:** Implemented a two-layer token system: immutable primitives (gray-50..950, indigo-50..950, red/amber/green/blue status hues, spacing 4-96, radius, elevation) in primitives.ts, and a semantic role mapping (21 roles: surface, surface-raised, surface-sunken, border-default, border-subtle, text-primary, text-secondary, text-muted, text-inverse, accent, accent-hover, accent-fg, focus-ring, danger, warning, success, info, sla-running, sla-warning, sla-paused, sla-breached) in semantic.ts that generates LIGHT_TOKENS and DARK_TOKENS as well as CSS blocks for the theme files. Light and dark CSS custom-property layers use [data-theme="light/dark"] selectors with forced-colors and print media overrides. The Tailwind v3 preset maps all semantic roles to var(--on-color-*) references in theme.extend.colors, with grid-12 plugin, typography tokens (display, heading-1..3, body, body-sm, label, mono), spacing, borderRadius and boxShadow. ThemeProvider is a React 'use client' component with localStorage persistence, matchMedia subscription, and structured console warnings for storage errors. The themeScript IIFE is injected before first paint via dangerouslySetInnerHTML to set data-theme synchronously. Both apps/web-agent and apps/web-portal are scaffolded as Next.js 15 App Router stubs with the preset and ThemeProvider wired into layout.tsx and a /token-showcase route. WCAG 2.2 AA contrast ratios were verified analytically for all 18 committed pairs. SLA colour-blind safety is enforced via deuteranopia/protanopia matrix simulation tests that assert non-colour-channel presence (distinct iconName + patternClass) for every state pair.

## WO-060: User Story: WO-060 - AI synthesis persistence schema with tenant RLS
- **Status:** completed
- **Commit:** `85208b5`
- **Files:** 11 (+1477/-2)
- **Duration:** 812ss
- **Approach:** Mirrored the existing tenant-scoped table pattern (leading tenant_id, composite PK, RLS ENABLE+FORCE+policy) for two new tables: ticket_ai_summaries and ticket_affected_areas. Created the Drizzle schema file, a hand-edited SQL migration with CHECK constraint on ai_status and tenant_isolation RLS policies, a repository module with all CRUD/compliance operations, and wired both tables into the DataSubjectErasure orchestrator and the retention purge manifest. Extended the existing schema-invariants test suite to assert RLS coverage for all 14 tenant-scoped tables. Added Testcontainers integration tests covering schema invariants, cross-tenant isolation, RLS WITH CHECK enforcement, upsert idempotency, attempt_count increment, replaceAffectedAreas with deduplication, and physical deletion via deleteAiDataForTickets. FK to the partitioned tickets table was omitted (partitioned PK composite limitation); cascade handled via purge manifest instead.

## WO-092: User Story: WO-092 - Append-Only Partitioned Audit Log Store
- **Status:** completed
- **Commit:** `15fefa8`
- **Files:** 8 (+1762/-7)
- **Duration:** 984ss
- **Approach:** Built on the existing audit_logs partitioned table (created in 0001_foundation.sql; RLS already set in 0009_identity_rls.sql). Migration 0092 adds 9 missing columns via ALTER TABLE ADD COLUMN IF NOT EXISTS (all nullable, expand-only), adds two composite indexes (resource and actor-id leading with tenant_id), creates the audit_logs_block_mutation() SECURITY DEFINER trigger function and attaches it BEFORE UPDATE OR DELETE on both the parent and existing default partition, and creates ensure_audit_partitions(months_ahead) which creates monthly partitions and attaches the trigger to each. Pure hash helpers (canonicalSerialize, computeChainHash, deriveChangedFields, truncateState, partitionName) are isolated in audit-hash.ts with no framework coupling. AuditWriter is a plain TypeScript class with constructor-injected RedisHashCache (optional) and ClockFn ports; appendBatch() sorts records by occurred_at before processing so the chain order matches verifyChain()'s read order; advisory lock uses pg_try_advisory_xact_lock with 3 retries over ~2s. Unit tests cover all 5 pure helpers with table-driven cases. Integration tests use Testcontainers PostgreSQL 16 and verify all 5 required scenarios. Fixture generator produces 3 × 500 = 1500 rows with valid chains, pre-sorted before chunking for cross-chunk chain consistency.

## WO-003: User Story: WO-003 - Enforce Row-Level Security Policies and Restricted DB Role
- **Status:** completed
- **Commit:** `bb48da8`
- **Files:** 8 (+1555/-0)
- **Duration:** 967ss
- **Approach:** Migration 0002_rls.sql enables FORCE ROW LEVEL SECURITY on all 8 foundation tables from 0001_foundation.sql and installs deny-by-default tenant_isolation policies using current_setting('app.current_tenant', true)::uuid (fail-closed: NULL when unset). Portal RESTRICTIVE policies on tickets (portal_org_restriction) and ticket_comments (portal_comment_restriction) are AND'd with the tenant policy so portal principals are narrowed to org-scoped tickets and public-only comments. app_current_org_ids() STABLE SECURITY DEFINER function parses app.current_org_ids comma-separated setting. Migration 0003_roles_grants.sql creates opsninja_migrator (DDL role, CREATEROLE, INHERIT, ALL PRIVILEGES on public) and opsninja_app (runtime canonical, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOLOGIN, USAGE-only on public). table-registry.ts is the single source of truth listing every table with tenantScoped, portalVisible, appUserGrants metadata. policy-builder.ts generates idempotent ENABLE+FORCE+DROP/CREATE SQL from the registry so no table can be forgotten. grants.md documents the full role/grant matrix. rls.fixtures.ts extends identity fixtures with two tickets (ORG_A1 and ORG_A2) and four comments (public + internal on A1, public on A2, public on B1). rls-isolation.test.ts covers all 10 test scenarios from the testing strategy. rls-metadata.test.ts asserts pg_class RLS flags, portal policy existence, audit_logs grant exclusions, and policy-builder unit correctness.

## WO-005: User Story: WO-005 - Deliver Staff OIDC Login With Rotating Refresh Sessions
- **Status:** completed
- **Commit:** `988e20c`
- **Files:** 14 (+3476/-0)
- **Duration:** 851ss
- **Approach:** Implemented OIDC Authorization Code + PKCE staff authentication as a stack of plain TypeScript classes with injectable ports (clock, key-value store, throttle store, fetch). Migration 0004_sessions.sql creates the refresh_sessions table with family_id (group-level revocation) and rotated_at (reuse detection) columns BEFORE migration 0009 runs; 0009's CREATE TABLE IF NOT EXISTS is a no-op. The Drizzle sessions.ts schema was updated to add familyId and rotatedAt fields. TokenService uses jose SignJWT/jwtVerify with multi-key verification for signing-key rotation and an injectable clock for deterministic testing. SessionService implements rotation reuse detection: a token presented with rotated_at != null triggers family revocation via revokeFamilyById(). OidcService handles OIDC discovery caching, PKCE S256 challenge generation, single-use state storage, ID token validation (issuer, audience, nonce, signature via JWKS), and a negative-cache guard for unknown kid values. UsersRepository handles email-domain tenant resolution and staff user provisioning with ON CONFLICT DO UPDATE. AuthController is a framework-agnostic class returning plain AuthRequest/AuthResponse objects with correct cookie attributes (httpOnly, Secure, SameSite=Strict, path-scoped). JwtAuthGuard verifies Bearer tokens and optionally consults a RevocationStore for JTI revocation and user deactivation signals. InMemoryKeyValueStore (PKCE state) and InMemoryThrottleStore (rate limiting) provide test implementations. MockOidcProvider uses jose generateKeyPair to create a static RSA-256 keypair served via in-process HTTP server for offline testing.
