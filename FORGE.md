# Forge Implementation Log

| Field | Value |
|-------|-------|
| Project | 3983812c-515c-41d5-a5eb-182d0b34cc21 |
| Branch | forge/opsninja-d3d5df73-run10-88wo |
| Started | 2026-08-11T05:29:18Z |

---

## WO-004: User Story: WO-004 - Implement Tenant Context Interceptor and Transaction Scope
- **Status:** completed
- **Commit:** `2ffdcfc`
- **Files:** 31 (+2730/-0)
- **Duration:** 1030ss
- **Approach:** Bootstrapped an empty repo as an npm workspace monorepo (apps/api + packages/db) with TypeScript 5.6 / NestJS 10 / Drizzle ORM, then implemented the WO-004 tenant-context interceptor and transaction scope. The single withTenantTransaction function acquires a pg PoolClient, issues BEGIN, then one batched SELECT set_config(...) call for all six session variables (tenant, user, principal kind, org IDs, statement timeout, idle timeout), stores PrincipalContext + TxHandle in AsyncLocalStorage via requestContextStore.run(), and guarantees COMMIT/ROLLBACK. The TenantContextInterceptor consults @NoTenantContext allow-list via Reflector, validates the JWT principal, and wraps next.handle() inside withTenantTransaction. TenantRepository resolves the tx handle from ALS and throws TENANT_CONTEXT_MISSING if called outside a bound context. An ESLint boundary rule restricts raw pool imports to apps/api/src/data.

## WO-011: User Story: WO-011 - Access token issuance and rotating refresh session store
- **Status:** completed
- **Commit:** `86f039b`
- **Files:** 18 (+2284/-0)
- **Duration:** 930ss
- **Approach:** Implemented RS256 JWT access token issuance (TokenService) and opaque rotating refresh session store (SessionService + RedisModule + IdentityModule). Access tokens are 15-minute RS256 JWTs with kid-based rotation support and a JWKS endpoint for workers. Refresh tokens are 256-bit random opaque values; only the SHA-256 hash is persisted to Redis. An atomic Lua script performs compare-and-swap rotation with a 30-second grace window for parallel-tab tolerance. Reuse detection triggers family-wide revocation and a high-severity audit event. Sessions are also audited to Postgres via RefreshSessionRepository (best-effort, outside the tenant transaction). The AuthController exposes POST /auth/refresh and POST /auth/logout with httpOnly/Secure/SameSite=Strict cookies at Path=/api/v1/auth. cookie-parser is registered before the global prefix so Express reads the cookie correctly.

## WO-012: User Story: WO-012 - RBAC route guard and principal context propagation
- **Status:** completed
- **Commit:** `fa16c67`
- **Files:** 17 (+1581/-44)
- **Duration:** 819ss
- **Approach:** Implemented a global AuthGuard (APP_GUARD) that runs before TenantContextInterceptor in the NestJS pipeline. The guard: (1) bypasses @Public routes, (2) extracts and verifies the RS256 Bearer token via the existing TokenService, (3) denies by default when no @RequirePermission or @Public metadata exists (OWASP A01), (4) enforces audience — machine tokens may only satisfy machine:* permissions and vice versa, (5) resolves permissions via PermissionResolverService (Redis 60s cache with in-memory fallback; never fail open), (6) writes immutable audit_logs records on every 401/403 via AuditService (write failure logs operator alert but never suppresses the denial). The Permission type union (27 permissions) is the compile-time catalogue. ROLE_PERMISSIONS maps 7 roles to permission sets. A route-inventory test enumerates all controllers and fails if any route handler lacks either decorator.

## WO-015: User Story: WO-015 - Portal user visibility hardening and internal note protection
- **Status:** completed
- **Commit:** `8c9df83`
- **Files:** 25 (+1603/-10)
- **Duration:** 1216ss
- **Approach:** Portal visibility hardening implemented across three independent enforcement layers: (1) AuthGuard audience separation using @PortalRoute() decorator — portal tokens rejected on staff routes and vice versa, both audited; (2) repository-layer data predicates using ScopedQueryHelper — portalCommentPredicate applies organization_id=boundOrg AND visibility='public', portalTicketPredicate applies organization_id=boundOrg, both applied automatically per getPrincipalContext() with no handler parameter to disable them; (3) portal DTO mappers with explicit per-field mapping — no entity spread, internal fields (assigneeId, affectedAreaTags, tenantId, visibility, s3Key) structurally absent. PortalPrincipal is a discriminated type narrowing PrincipalContext to carry required boundOrganizationId. AttachmentAccessService resolves attachment→comment visibility before minting pre-signed URLs, fails closed. Per-tenant portalAiSummaryEnabled defaults false, evaluated in the portal mapper.

## WO-019: User Story: WO-019 - Deliver OpsNinja Domain Primitives and DataTable
- **Status:** completed
- **Commit:** `75f1de4`
- **Files:** 32 (+2315/-0)
- **Duration:** 874ss
- **Approach:** Created @opsninja/ui-kit from scratch with a functional-core/imperative-shell split: computeRemaining is a pure function tested without React; SlaClockProvider owns the single shared interval and aria-live region; SlaCountdown subscribes to the provider and renders via slaStateMeta tokens. SlaHint is fully isolated from the countdown stack to serve the portal bundle. DataTable is a controlled headless grid with a useGridKeyboardNavigation hook implementing the roving-tabindex ARIA grid pattern. JiraLinkChip URL guard validates protocol=https before rendering any anchor. Two fixture files drive all unit tests. The portal-dependency-graph test traces static imports to assert SlaCountdown is unreachable from portal.ts. @opsninja/web-agent provides a Playwright config and a queue-sla spec with 5-second delta replay and axe-core assertions.

## WO-020: User Story: WO-020 - Implement Agent Workspace Application Shell
- **Status:** completed
- **Commit:** `e090011`
- **Files:** 39 (+2565/-5)
- **Duration:** 590ss
- **Approach:** Built the full Next.js 15 App Router shell. Navigation is declarative config (navConfig.ts) filtered by a pure canFor() RBAC helper that removes items from the DOM — never CSS-hides them. Sidebar collapse is SSR-safe (read from localStorage after hydration, defaulting to expanded on failure). LiveStatusPill reads a Zustand store written by the realtime layer; the shell never opens the WebSocket. ExportMenu dispatches to a page-registered React context handler; renders disabled with aria-disabled when no page has registered. ShellErrorBoundary extracts traceId from the API error envelope, shows a recoverable Retry panel, never exposes stack traces. Identity and org-scope are TanStack Query fetches with suspense skeleton fallbacks. AppShell owns all cross-cutting concerns; feature pages contribute content only.

## WO-022: User Story: WO-022 - Build Isolated Customer Portal Shell Bundle
- **Status:** completed
- **Commit:** `15b8269`
- **Files:** 36 (+2133/-0)
- **Duration:** 1023ss
- **Approach:** Built the portal shell as a structurally distinct Next.js 15 App Router application. The shell composes PortalHeader (org logo + initials fallback, read-only OrgScopePill, HelpLink, theme toggle, PortalUserMenu) + PortalTabs (route-driven via usePathname, aria-current, keyboard nav) + CsatBanner (role=status, SSR-safe localStorage dismissal per survey id) + PortalFooter (legal/support links). Portal isolation is mechanical, not conventional: ESLint no-restricted-imports blocks root barrel and all agent-only paths at lint time; scripts/assert-bundle-isolation.ts scans .next/ chunks against a deny-list at build time. All portal components import exclusively from @opsninja/ui-kit/portal (the portal-safe subset). CSP is stricter than the agent app with no unsafe-inline for scripts, frame-ancestors none, X-Content-Type-Options, and Referrer-Policy.

## WO-038: User Story: WO-038 - Allow-Listed Saved View Filter AST Compiler
- **Status:** completed
- **Commit:** `c48493f`
- **Files:** 26 (+2786/-1)
- **Duration:** 917ss
- **Approach:** Delivered @opsninja/filter-compiler as a self-contained workspace package with no framework dependencies (no NestJS, no Drizzle, no @opsninja/db). The core security guarantee is that compileToPredicate emits only $n positional placeholders — user-supplied values are never interpolated into the sql string. The field registry is the single declarative allow-list: unknown fields and operator/field mismatches are impossible to persist because they are rejected at parse time with typed ValidationResult errors. tag_id and affected_area use EXISTS subqueries to prevent M:N row multiplication. Relative date tokens resolve against an injected Clock so tests are fully deterministic. computeSignature produces a canonical SHA-256 hash (sorted keys, version-prefixed) suitable as a Redis cache key. ViewsService and ReportingService are the sole API consumers — both delegate to parseFilterAst + compileToPredicate, never build filter SQL themselves.

## WO-072: User Story: WO-072 - Reporting Read-Replica Data Source With Guardrails
- **Status:** completed
- **Commit:** `5bf1179`
- **Files:** 15 (+1298/-2)
- **Duration:** 1118ss
- **Approach:** Created a self-contained reporting infrastructure module with a dedicated read-replica pg.Pool (REPORTING_DB DI token, max 8 connections). The pool's on-connect hook sets statement_timeout=30000, idle_in_transaction_session_timeout=60000, and default_transaction_read_only=on at the session level. TenantScopedReplicaRunner mirrors the primary unit-of-work pattern: it reads PrincipalContext from AsyncLocalStorage, opens a transaction, issues SET LOCAL app.current_tenant via set_config(name, value, true) for PgBouncer transaction-pooling compatibility, then runs the callback. A row-cap guard wraps queries in SELECT * FROM (sql) LIMIT 500001 and throws RowLimitExceededError if the overflow row is present. ReplicaLagProbe polls pg_last_xact_replay_timestamp() on a 15s setInterval, handles the null case for single-node dev, and exposes getReplicaFreshness() plus isHealthy(). The /health/reporting-replica endpoint returns 503 (ServiceUnavailableException) when the probe reports unhealthy. BOOTSTRAP.sql documents the NOSUPERUSER NOBYPASSRLS role setup. The ESLint reporting-module-boundary rule explicitly blocks primary DB pool imports within the module.

## WO-080: User Story: WO-080 - Notification Engine Schema and SES Email Delivery Worker
- **Status:** completed
- **Commit:** `e9f3056`
- **Files:** 39 (+2336/-1)
- **Duration:** 836ss
- **Approach:** Implemented the notification engine end-to-end: (1) Drizzle schema for notification_templates, notifications (RANGE-partitioned monthly), and notification_suppressions with SHA-256 email hashing; (2) migration SQL with RLS FORCE policies and pre-created 2026-Q3/Q4 partitions; (3) ports-and-adapters pattern for email sending (EmailSenderPort, SesEmailSender via IRSA, InMemoryEmailSender for tests); (4) NestJS NotificationsModule in apps/api with template rendering (Handlebars, manifest allowlist), repository with idempotency (ON CONFLICT DO NOTHING on dedupeKey), and admin REST controller for template metadata; (5) standalone notification-worker app with SQS long-polling consumer, per-tenant Redis token bucket rate limiter, SES bounce/complaint event handler, and graceful SIGTERM drain; (6) @opsninja/observability package with log redactor that strips RFC5322 email addresses and rendered bodies before any log output; (7) Helm values with DLQ CloudWatch alarm.

## WO-083: User Story: WO-083 - Tenant Webhook Subscription Management with SSRF Guard
- **Status:** completed
- **Commit:** `a681978`
- **Files:** 29 (+1916/-1)
- **Duration:** 605ss
- **Approach:** Implemented the webhook subscription management plane with SSRF control. Key decisions: (1) validateWebhookUrl is a pure async function returning a verdict+resolvedAddresses tuple — same function called at registration and delivery time (DNS rebinding defense); (2) EVENT_CATALOGUE is the single source of truth for both the public REST endpoint and the internal event-type validator — drift is structurally impossible; (3) @opsninja/crypto new package provides EnvelopeCipherPort backed by KMS AES-256-GCM with a tenant_id encryption context, plus InMemoryEnvelopeCipher for tests; (4) KMS failure during creation throws 503 and persists nothing — no endpoint exists without a usable secret; (5) secret rotation uses a previous_secret_ciphertext + previous_secret_expires_at grace window — invoking rotation twice discards the older previous; (6) writeAudit() runs inside the same Drizzle transaction as every mutation — if the audit insert fails, the mutation rolls back; (7) secrets are stripped from logs by the extended log-redactor.

## WO-093: User Story: WO-093 - Cross-Cutting Audit Capture for All Mutations
- **Status:** completed
- **Commit:** `e0276bc`
- **Files:** 24 (+1760/-2)
- **Duration:** 1275ss
- **Approach:** Implemented the full cross-cutting audit infrastructure as a NestJS-level cross-concern: (1) AuditContext AsyncLocalStorage store seeded by AuditInterceptor (HTTP) or withAuditContext() wrapper (workers); (2) AuditWriter injectable that writes inside the existing withTenantTransaction() handle — fail-closed, audit failure = mutation rollback; (3) @Auditable method decorator + AuditCoverageRegistry singleton for bootstrap-time enumeration; (4) DefaultRedactor for Confidential-tier field redaction using a RedactionPort interface (swap-compatible with WOREF-094 redactor); (5) deriveChangedFields() with recursive JSONB dotted-path diffing (skips no-op PATCHes); (6) Migration 0003 extends audit_logs with 11 mutation columns + unique partial index on idempotency_key for worker dedup; (7) CommentRepository.insert() annotated and wired; (8) AuthController emits auth.token_refresh and auth.logout events via existing AuditService; (9) CI guard test with explicit exemptions allow-list for modules not yet implemented.

## WO-097: User Story: WO-097 - Anonymised Multi-Tenant Seed and Fixture Generator
- **Status:** completed
- **Commit:** `2fbb6b0`
- **Files:** 25 (+1891/-1)
- **Duration:** 745ss
- **Approach:** Built packages/test-seed as a standalone TypeScript strict workspace package. Core design: (1) SeededRandom (Mulberry32 PRNG) — all randomness flows through this class, Math.random is banned structurally so determinism is guaranteed; (2) Pure factory functions (no DB access) layered over Drizzle schema types — schema drift breaks the build at compile time; (3) Partition-spanning date generation ensures tickets/comments/audit_logs cover 14+ distinct monthly partitions plus one beyond the 7-year retention horizon; (4) Collision matrix explicitly lists natural keys (email local-parts, org names, ticket subjects) shared across all 3 tenants; (5) AnonymisationValidator scans generated records for disallowed patterns (real email domains, phone, IPv4, AWS keys); (6) SeedRunner persistence shell streams inserts in configurable batches with a test-host guard; (7) Three scale profiles: small (~400 tickets), medium, large (year-1 volumes at configurable fraction). Note: tables referenced in WO that don't exist in the current schema (sla_timers, jira_connections, saved_views, etc.) are planned stubs — the factories for those will be added when their schemas land.

## WO-006: User Story: WO-006 - Enforce RBAC Permissions and Agent Organization Scoping
- **Status:** completed
- **Commit:** `8ba88cf`
- **Files:** 20 (+1174/-8)
- **Duration:** 1001ss
- **Approach:** Implemented RBAC permission enforcement and agent org scoping in three layers: (1) Permission matrix — added org:manage_scopes to catalog, assigned to admin/manager roles; RequirePermissions (plural) decorator uses the same REQUIRE_PERMISSION_KEY so the existing AuthGuard reads it without changes. (2) Org-scope versioning — OrgScopeService in common/auth/ uses global db client (not tenant tx) for cold-start fallback since it runs in the auth guard before any transaction opens; Redis keys are version-keyed so old keys become unreachable on bump; atomic INCR prevents lost version increments under concurrent mutations; AuthGuard compares token's org_scope_version to Redis counter and throws 401 SCOPE_VERSION_STALE on mismatch, then populates orgScopeIds on the principal. (3) Scope predicate — buildOrgScopePredicate produces a parameterised Drizzle condition: null for admin/lead_analyst (tenant-wide), sql`false` for empty scope set, eq for portal principals, inArray for normal sets, EXISTS subquery above threshold; applied to TicketRepository.findAll and findById. maskNotFound helper ensures out-of-scope and missing resources produce identical 404 responses. OrganizationsModule exposes GET/PUT /api/v1/organizations/agent-scopes/:userId requiring org:manage_scopes, validates org tenant membership, writes audit via AuditWriter, and bumps scope version atomically.

## WO-008: User Story: WO-008 - Automate Cross-Tenant Isolation Test Harness and Fixtures
- **Status:** completed
- **Commit:** `23644d0`
- **Files:** 16 (+1426/-1)
- **Duration:** 698ss
- **Approach:** Built a deterministic two-tenant isolation test harness. Fixture factory uses fixed f0000000-... UUIDs so tests are reproducible across runs. RS256 JWT minting handles all 12 principal variants including stale-scope-version token. DB suite validates RLS metadata (enabled/forced policy) and negative privileges (app role cannot bypass RLS). API suite uses ROUTE_ANNOTATIONS map for exhaustive cross-tenant 404 enforcement. Meta-tests prove the harness has teeth by introducing deliberate violations and asserting they would be detected. All wired into turbo test:isolation.

## WO-013: User Story: WO-013 - Agent organization scope enforcement and scope-change reauthorization
- **Status:** completed
- **Commit:** `a7cddbd`
- **Files:** 11 (+850/-14)
- **Duration:** 708ss
- **Approach:** WO-013 builds on top of WO-006 infrastructure. Key changes: (1) Updated auth guard scope-version-mismatch error code from SCOPE_VERSION_STALE to AUTH_REAUTHORIZE_REQUIRED with details:[{reason:'scope_changed'}] per the WO-013 API contract. (2) Fixed validation error for cross-tenant org IDs: changed from 404 NotFoundException to 422 UnprocessableEntityException with code ORG_SCOPE_INVALID_ORGANIZATION. (3) Added new /api/v1/users/:userId/org-scope endpoint path (GET + PUT) with correct response shapes — GET returns {userId, tenantWide, organizationIds, scopeVersion}; PUT returns {scopeVersion, added, removed} diff. UsersController delegates to two new methods on AgentScopesService: getUserOrgScope and replaceUserOrgScope. (4) Architecture test scans repository files for missing org-scope predicate calls. (5) Three-org/two-agent fixture and comprehensive integration test suite covering all 10 ACs including the scope-narrowing reauthorization scenario.

## WO-016: User Story: WO-016 - Authentication abuse throttling and security audit telemetry
- **Status:** completed
- **Commit:** `1fd0c67`
- **Files:** 12 (+1002/-4)
- **Duration:** 609ss
- **Approach:** Created ThrottleService (Redis INCR+lockout pattern, SHA-256 subject keys, fail-closed on Redis failure), ThrottleGuard (NestJS CanActivate, Retry-After from actual TTL, uniform 429 AUTH_RATE_LIMITED envelope), PII redactor (hash email/phone/IP, redact free-text), AuthAuditEmitter (single funnel for all identity security events), and AdminAuthController (POST /api/v1/admin/auth/unlock with admin:unlock_auth permission). Added admin:unlock_auth to permission catalog and ALL_PERMISSIONS. SecurityModule exports ThrottleService and ThrottleGuard; IdentityModule imports SecurityModule. ThrottleGuard applied @UseGuards on the refresh endpoint.
