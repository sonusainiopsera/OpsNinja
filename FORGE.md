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
