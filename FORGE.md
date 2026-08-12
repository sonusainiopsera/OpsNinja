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

## WO-021: User Story: WO-021 - Build Typed API Client With Silent Token Refresh
- **Status:** completed
- **Commit:** `ccdf10a`
- **Files:** 29 (+2085/-17)
- **Duration:** 535ss
- **Approach:** Created packages/api-client as a shared workspace package with dual browser/server entry points. Layered architecture: ApiError class with type guards → parseErrorEnvelope (handles malformed/empty/HTML bodies) → createRequestFn (fetch wrapper with credentials, timeout, AbortController) → retry logic (Retry-After + jitter, never-retry list, POST/PATCH never retried) → cursor pagination (limit clamped 1-100) → SessionManager (single-flight refresh via refreshPromise, loop guard via _isReplay flag, scope-changed 401 fails closed to reauthorization-required, unknown 401 codes also fail closed). TanStack Query factory with taxonomy-aligned retry predicates. Server entry point requires explicit cookieHeader. Both consumer apps wired with thin factory clients. MSW v2 handlers and JSON fixtures for all status codes. Vitest test suites including 5-concurrent-401 single-flight test and loop-guard test.

## WO-023: User Story: WO-023 - Organization registry schema with tenant-scoped RLS policies
- **Status:** completed
- **Commit:** `7a9dad1`
- **Files:** 7 (+989/-0)
- **Duration:** 585ss
- **Approach:** Expand/contract migration adds 7 columns to the existing organizations table (slug, sla_tier, region, status, custom_field_values, primary_contact_id, deactivated_at) plus a composite UNIQUE (tenant_id, id) constraint needed as the FK target for new tables. Four new tables — customer_accounts, contacts, organization_verified_domains, custom_field_defs — each carry a composite FK referencing (tenant_id, id) on organizations so cross-tenant references are impossible at the DB constraint level. The citext extension enables case-insensitive email storage in contacts. ENABLE FORCE ROW LEVEL SECURITY plus tenant_isolation_* policies (USING/WITH CHECK on tenant_id = current_setting('app.current_tenant')::uuid) are installed on all five tables. The ::uuid cast on an empty string throws rather than returning all rows, giving fail-closed behavior when app.current_tenant is unset.

## WO-039: User Story: WO-039 - System And Custom Saved Views API With Pinning
- **Status:** completed
- **Commit:** `f127c1a`
- **Files:** 17 (+1728/-21)
- **Duration:** 740ss
- **Approach:** Implemented the saved-views API end-to-end: (1) Drizzle schema for `saved_views` and `saved_view_pins` with ENABLE/FORCE RLS and tenant_isolation policies; (2) idempotent system-views seeder using ON CONFLICT DO NOTHING keyed on (tenant_id, slug) with CURRENT_USER / LAST_7_DAYS placeholder tokens; (3) ViewsRepository extending TenantRepository with @Auditable on all write methods; (4) ViewsService with deep-walk placeholder substitution at read time, write-time AST + column allow-list validation, system-view immutability guard (403), cross-user private-view 404 fence, and full pin/reorder logic; (5) ViewsController with 10 endpoints ordered so PUT /pins/order is declared before PUT /:id/pin to avoid NestJS route shadowing; (6) five new permissions (view:read/create/update/delete/share) added to the permission catalog and assigned to appropriate roles.

## WO-044: User Story: WO-044 - SLA policy and business calendar schema with tenant-scoped CRUD API
- **Status:** completed
- **Commit:** `840ea75`
- **Files:** 20 (+2233/-8)
- **Duration:** 785ss
- **Approach:** Implemented the SLA configuration store end-to-end: (1) Drizzle schema for 5 tables with tenant_id-leading composite indexes; (2) expand-only migration 0007 with ENABLE/FORCE RLS, tenant_isolation_* policies, CHECK constraints for scope_type/priority/calendar_type/reminder thresholds/target minutes, unique partial index on active (tenant,scope,priority), and an append-only trigger on sla_policy_versions; (3) Zod strict DTOs with IANA timezone allow-list validation via Intl.supportedValuesOf, business_hours calendar zero-window rejection, duplicate holiday date rejection, and reminder-threshold superRefine; (4) TenantRepository subclasses with @Auditable on all write methods; (5) services with optimistic concurrency (ifMatchVersion → 409 on mismatch) and deactivate-idempotency guard (409 if already inactive), with version snapshot written atomically alongside each mutation; (6) RBAC-guarded controllers at /sla-policies and /sla-calendars under the global /api/v1 prefix; (7) idempotent P1–P4 provisional seed (targets_ratified=false); (8) unit DTO validation tests and DB characterisation tests covering RLS, constraints, append-only trigger, fail-closed, and cross-tenant isolation.

## WO-051: User Story: WO-051 - Per-Tenant Jira Connection and Credential Vault
- **Status:** completed
- **Commit:** `d39151a`
- **Files:** 23 (+1929/-8)
- **Duration:** 1024ss
- **Approach:** Implemented the full per-tenant Jira connection and credential vault as a NestJS module with four submodules: connections (CRUD + lifecycle), oauth (PKCE 3LO handshake), tokens (caching + single-flight refresh), and http (Jira API client). The Drizzle schema uses expand-only DDL with FORCE RLS, a global unique partial index on cloud_id to prevent cross-tenant binding, and @Auditable decorators on all write mutations. Credentials are never stored directly — the AwsSecretVaultAdapter envelope-encrypts with KMS and stores only the secret_ref in the DB. The JiraTokenProvider uses a Map<lockKey, Promise<string>> for single-flight refresh and Redis caching with 60s expiry skew.

## WO-066: User Story: WO-066 - Realtime Gateway WebSocket Service with Tenant Channel Auth
- **Status:** completed
- **Commit:** `d9c4c0a`
- **Files:** 20 (+2067/-0)
- **Duration:** 802ss
- **Approach:** Scaffolded apps/realtime-gateway as a standalone NestJS application (port 8081). Core design: DashboardGateway service manages ws.Server (noServer:true, 64KB maxPayload) attached to the NestJS Express HTTP server after listen(); upgrade handler enforces the pod-level connection cap (HTTP 503 + Retry-After) and path guard before the WebSocket handshake completes. Authentication runs after the WS connection is established: WsJwtVerifier extracts the Bearer token from Authorization header or Sec-WebSocket-Protocol subprotocol, verifies RS256 JWT (same key convention as the API), rejects portal tokens, and closes with 4401 on any failure. OrgScopeResolver reads pre-cached scope IDs from Redis using the same key format as OrgScopeService in apps/api (tenant:{tenantId}:user:{userId}:scopes:v{scopeVersion}). ConnectionRegistry is a pure in-memory Map<tenantId,Set<SocketWrapper>> + principal counter map. PubSubSubscriber holds a dedicated ioredis client subscribed once per pod to pattern dash:*, applying applyOrgScopeFilter() before delivering frames to each socket. Heartbeat at HEARTBEAT_INTERVAL_MS (30s default) with 10s pong timeout reaper. Scope revalidation at SCOPE_REVALIDATE_MS (60s) compares token org_scope_version against Redis counter. Graceful SIGTERM drain: set draining flag, broadcast going_away frames, sleep DRAIN_GRACE_MS (20s), force-close remaining sockets.

## WO-073: User Story: WO-073 - Report Definition Schema And Allow-Listed Query Compiler
- **Status:** completed
- **Commit:** `0233ab5`
- **Files:** 14 (+2030/-2)
- **Duration:** 1137ss
- **Approach:** Implemented WO-073 in four layers. (1) DB layer: additive migration 0009_report_definitions.sql creates report_definitions (id, tenant_id, name, description, metrics jsonb, group_by jsonb, filter_ast jsonb, chart_type, sharing_scope, schedule, created_by, timestamps, deleted_at) and export_jobs (id, tenant_id, report_definition_id FK ON DELETE SET NULL, requested_by, format, status, s3_key, row_count, byte_size, error_code, expires_at, timestamps) — both with tenant_id-leading indexes, ENABLE/FORCE RLS, and tenant_isolation policies. Drizzle schema files created at packages/db/src/schema/. (2) Domain layer: ReportFieldCatalog is a frozen record with 11 dimensions (organization, organization_tier, category_path, sub_category, priority, status, assignment_group, agent, ai_affected_area, created_date, resolved_date) and 8 metrics (ticket_count, avg_resolution_minutes, median_resolution_minutes, p90_resolution_minutes, sla_attainment_pct, sla_breach_count, avg_first_response_minutes, csat_avg), each entry carrying sqlExpression, dataType, allowedOperators, requiresJoin?, classification='standard', fieldKind. Restricted-tier fields are absent from the catalog entirely. (3) Filter AST: Zod discriminated-union schema (condition/group nodes) with max depth 4 and max 50 node guards; semantic validation against catalog; error codes REPORT_FILTER_INVALID_FIELD, REPORT_FILTER_INVALID_OPERATOR, REPORT_FILTER_TYPE_MISMATCH, REPORT_FILTER_TOO_DEEP, REPORT_FILTER_TOO_LARGE, REPORT_FILTER_INVALID_STRUCTURE; re-validation on load detects DEFINITION_FIELD_RETIRED. (4) Query compiler: compileReportQuery() builds fully parameterised SQL with no template-literal interpolation of user values; always appends tenant predicate (current_setting('app.current_tenant')::uuid) and org-scope predicate (organization_id = ANY($n)); determines required JOINs from catalog's requiresJoin entries; wraps nullable GROUP BY dimensions in COALESCE(..., 'Unassigned'); SHA-256 signature over sorted canonical JSON including orgScopeVersion. ReportDefinitionsRepository extends TenantRepository with @Auditable on create/update/softDelete.

## WO-082: User Story: WO-082 - Automated CSAT Survey Dispatch and Token Response Capture
- **Status:** completed
- **Commit:** `8382636`
- **Files:** 20 (+1704/-0)
- **Duration:** 1335ss
- **Approach:** Implemented the full CSAT loop in five layers. (1) DB: migration 0010 creates csat_surveys with a two-branch RLS policy — the normal branch uses NULLIF(current_setting('app.current_tenant', true), '')::uuid to fail-closed without errors when tenant absent; the bootstrap branch lets CsatTokenGuard resolve tenant_id from token_hash by setting SET LOCAL app.csat_bootstrap_hash before the lookup query. WITH CHECK restricts writes to the normal branch only. Expand-only organization columns (csat_enabled, csat_fatigue_hours, csat_expiry_days) added. (2) Token security: CsatTokenService generates 32-byte CSPRNG → base64url (43 chars) for email links, stores SHA-256 hex (64 chars) as token_hash, and uses timingSafeEqual for constant-time verification. (3) Guard + rate limiter: CsatTokenGuard enforces Redis fixed-window limits (10/token/hr, 60/IP/hr) before any DB lookup, then does the bootstrap lookup, attaches resolved survey to request. 404 and 410 have identical error shapes. (4) Service layer: CsatService.submit() uses a single conditional UPDATE WHERE responded_at IS NULL RETURNING id — zero rows = 409, preventing double-submission races. CsatAggregationService runs against the read replica via TenantScopedReplicaRunner with 30s statement timeout, returns explicit zero-state. (5) Dispatch: CsatDispatchHandler in the notification worker checks org csat_enabled, fatigue window, and reopen suppression before inserting survey idempotently (ON CONFLICT DO NOTHING). CSAT comment added to log redactor REDACTED_KEYS. Portal page at /csat/[token] is a lightweight server-rendered Next.js page with no session requirement.

## WO-084: User Story: WO-084 - Signed Outbound Webhook Delivery Worker with Retry and Replay
- **Status:** completed
- **Commit:** `dfe00f2`
- **Files:** 30 (+2299/-1)
- **Duration:** 1027ss
- **Approach:** Implemented the webhook delivery worker as a new NestJS standalone app (apps/workers/webhook-worker) consuming an SQS FIFO queue. Core signing and serialisation logic is extracted into a new @opsninja/webhooks shared package so the worker and the existing test-fire endpoint share identical code paths. The worker pipeline: Zod-parse SQS envelope → load endpoint (RLS-scoped) → check Redis concurrency semaphore + tenant token bucket (Lua) → KMS-decrypt secret (in-memory only, never cached) → build canonical payload (stable-key JSON) → build HMAC-SHA-256 signature header (t=unix,v1=hex, dual-v1 during rotation) → undici POST with 10s/20s timeouts, zero redirects, SSRF re-validation → record idempotent attempt row → update consecutive_failures counter (auto-disable at threshold via atomic SQL CAS). Retries use SQS ChangeMessageVisibility with 1s/2s/4s/8s/60s/900s backoff. Delivery history and replay are exposed through two new API endpoints in the existing webhooks module.

## WO-087: User Story: WO-087 - Verification token lifecycle and transactional signup emails
- **Status:** completed
- **Commit:** `27c77b1`
- **Files:** 12 (+1518/-1)
- **Duration:** 660ss
- **Approach:** Implemented the full verification token lifecycle as three decoupled layers: (1) TokenCodec — a pure stateless crypto module that generates CSPRNG entropy + HMAC-SHA256 tag, stores only the SHA-256 hash server-side, and supports dual-key rotation overlap via PORTAL_TOKEN_SIGNING_KEY_PREVIOUS; (2) PortalVerificationService — owns issue/redeem/resend with all business rules (conditional consumed_at IS NULL consuming UPDATE, 60s Redis idempotency cache, 3/hr + 5/24h resend throttle, 5-failure-per-hour lockout, bootstrap-mode RLS via SET LOCAL app.portal_signup_bootstrap='true'); (3) PortalVerificationController — @Public @NoTenantContext endpoints with Zod DTOs, generic resend 202 for email enumeration prevention, and httpOnly Secure SameSite=Strict portal refresh cookie on success. Email notification is inserted into the notifications table (outbox pattern) so SES latency/outage never fails the HTTP response.

## WO-094: User Story: WO-094 - Data Classification Registry and PII Log Redaction
- **Status:** completed
- **Commit:** `983c36b`
- **Files:** 16 (+2300/-111)
- **Duration:** 1094ss
- **Approach:** N/A

## WO-101: User Story: WO-101 - End-to-End Critical Journey and Accessibility Regression Suite
- **Status:** completed
- **Commit:** `a2b8cff`
- **Files:** 27 (+2570/-0)
- **Duration:** 831ss
- **Approach:** N/A

## WO-014: User Story: WO-014 - Portal self-service signup with business email verification
- **Status:** completed
- **Commit:** `410a540`
- **Files:** 7 (+737/-1)
- **Duration:** 526ss
- **Approach:** N/A

## WO-024: User Story: WO-024 - Organization CRUD API with cursor pagination and filters
- **Status:** completed
- **Commit:** `f8d8e63`
- **Files:** 12 (+916/-3)
- **Duration:** 436ss
- **Approach:** N/A

## WO-025: User Story: WO-025 - Organization deactivation and reactivation lifecycle endpoint
- **Status:** completed
- **Commit:** `e9cc5e0`
- **Files:** 13 (+932/-12)
- **Duration:** 421ss
- **Approach:** N/A

## WO-026: User Story: WO-026 - DevOps metadata custom field definitions and JSONB validation
- **Status:** completed
- **Commit:** `53c6314`
- **Files:** 11 (+1324/-5)
- **Duration:** 618ss
- **Approach:** N/A

## WO-028: User Story: WO-028 - Verified email domain registry for organization auto-binding
- **Status:** completed
- **Commit:** `aefdb6c`
- **Files:** 10 (+1289/-3)
- **Duration:** 500ss
- **Approach:** N/A

## WO-031: User Story: WO-031 - Ticketing Core Schema With Tenant RLS Policies
- **Status:** completed
- **Commit:** `85dd467`
- **Files:** 13 (+1560/-82)
- **Duration:** 687ss
- **Approach:** N/A

## WO-040: User Story: WO-040 - Cached Agent Queue Listing With Cursor Pagination
- **Status:** completed
- **Commit:** `d2767bb`
- **Files:** 10 (+1244/-6)
- **Duration:** 718ss
- **Approach:** N/A

## WO-049: User Story: WO-049 - SLA policy and escalation settings admin console page
- **Status:** completed
- **Commit:** `dc85a9d`
- **Files:** 23 (+2973/-1)
- **Duration:** 810ss
- **Approach:** N/A

## WO-052: User Story: WO-052 - Jira Project Scoping and Field Mapping Configuration
- **Status:** completed
- **Commit:** `83c1c0a`
- **Files:** 9 (+1380/-0)
- **Duration:** 637ss
- **Approach:** N/A

## WO-054: User Story: WO-054 - Signed Jira Webhook Receiver with Idempotent Ingest
- **Status:** completed
- **Commit:** `c4b9f3b`
- **Files:** 16 (+1554/-1)
- **Duration:** 719ss
- **Approach:** N/A

## WO-074: User Story: WO-074 - Report Run Preview API And Saved Definition Sharing
- **Status:** completed
- **Commit:** `7a74f4a`
- **Files:** 8 (+614/-2)
- **Duration:** 543ss
- **Approach:** N/A

## WO-076: User Story: WO-076 - Streaming CSV Export Worker To S3
- **Status:** completed
- **Commit:** `eda88ef`
- **Files:** 6 (+477/-8)
- **Duration:** 474ss
- **Approach:** N/A

## WO-085: User Story: WO-085 - Notification Retention Purge and CSAT Erasure Compliance
- **Status:** completed
- **Commit:** `5e1ce98`
- **Files:** 13 (+889/-0)
- **Duration:** 565ss
- **Approach:** N/A

## WO-096: User Story: WO-096 - Compliance Audit Query and Subject Data Export API
- **Status:** completed
- **Commit:** `ac708ab`
- **Files:** 15 (+1232/-1)
- **Duration:** 532ss
- **Approach:** N/A

## WO-027: User Story: WO-027 - Organization contact management with portal access control
- **Status:** completed
- **Commit:** `4b70e5d`
- **Files:** 12 (+1516/-4)
- **Duration:** 397ss
- **Approach:** N/A

## WO-029: User Story: WO-029 - Admin console Organizations page with detail drawer tabs
- **Status:** completed
- **Commit:** `af558fe`
- **Files:** 8 (+1940/-3)
- **Duration:** 668ss
- **Approach:** N/A

## WO-032: User Story: WO-032 - Ticket Creation And Retrieval API Endpoints
- **Status:** completed
- **Commit:** `ebe6adb`
- **Files:** 8 (+1186/-9)
- **Duration:** 486ss
- **Approach:** N/A

## WO-033: User Story: WO-033 - Ticket Status Lifecycle And Concurrency-Safe Updates
- **Status:** completed
- **Commit:** `a2aead9`
- **Files:** 10 (+1706/-7)
- **Duration:** 582ss
- **Approach:** N/A

## WO-034: User Story: WO-034 - Ticket Comment Thread With Visibility Enforcement
- **Status:** completed
- **Commit:** `90f996e`
- **Files:** 11 (+943/-5)
- **Duration:** 500ss
- **Approach:** N/A

## WO-035: User Story: WO-035 - Attachment Upload Via Presigned S3 With MIME Verification
- **Status:** completed
- **Commit:** `64c6a54`
- **Files:** 16 (+1593/-12)
- **Duration:** 706ss
- **Approach:** N/A

## WO-041: User Story: WO-041 - Agent Workspace Queue Interface With SLA Countdowns
- **Status:** completed
- **Commit:** `d466084`
- **Files:** 19 (+3789/-12)
- **Duration:** 772ss
- **Approach:** N/A

## WO-045: User Story: WO-045 - Priority-based SLA target computation and dual timer creation
- **Status:** completed
- **Commit:** `c592b56`
- **Files:** 10 (+965/-3)
- **Duration:** 789ss
- **Approach:** N/A

## WO-053: User Story: WO-053 - Escalate Ticket to Jira Issue and Persist Link
- **Status:** completed
- **Commit:** `12a029d`
- **Files:** 10 (+1038/-3)
- **Duration:** 476ss
- **Approach:** N/A

## WO-058: User Story: WO-058 - Jira Integration Console for Connection and Sync Health
- **Status:** completed
- **Commit:** `dccbdf4`
- **Files:** 13 (+2152/-1)
- **Duration:** 696ss
- **Approach:** N/A

## WO-075: User Story: WO-075 - Scheduled Report Delivery With Idempotent Dispatch
- **Status:** completed
- **Commit:** `4c5ed3c`
- **Files:** 9 (+1646/-0)
- **Duration:** 613ss
- **Approach:** N/A

## WO-077: User Story: WO-077 - Sandboxed Chromium PDF Report Renderer
- **Status:** completed
- **Commit:** `b7ffc7f`
- **Files:** 12 (+1611/-20)
- **Duration:** 550ss
- **Approach:** N/A

## WO-078: User Story: WO-078 - Report Builder Workspace UI For Support Leads
- **Status:** completed
- **Commit:** `4f1a9e7`
- **Files:** 17 (+3286/-0)
- **Duration:** 679ss
- **Approach:** N/A

## WO-100: User Story: WO-100 - Publish Developer Portal and Outbound Webhook Catalogue
- **Status:** completed
- **Commit:** `77af5a8`
- **Files:** 29 (+2474/-4)
- **Duration:** 951ss
- **Approach:** N/A

## WO-030: User Story: WO-030 - Organization change audit trail and history API
- **Status:** completed
- **Commit:** `39b703a`
- **Files:** 6 (+764/-3)
- **Duration:** 683ss
- **Approach:** N/A

## WO-042: User Story: WO-042 - Ticket Detail Workspace And Resolve Modal
- **Status:** completed
- **Commit:** `c576495`
- **Files:** 15 (+3481/-0)
- **Duration:** 714ss
- **Approach:** N/A

## WO-043: User Story: WO-043 - Ticketing Isolation, E2E And Accessibility Test Suite
- **Status:** completed
- **Commit:** `9b002fd`
- **Files:** 10 (+2453/-2)
- **Duration:** 767ss
- **Approach:** N/A

## WO-046: User Story: WO-046 - Durable SLA timer scheduler worker with claim-and-fire loop
- **Status:** completed
- **Commit:** `b1267c5`
- **Files:** 10 (+2053/-0)
- **Duration:** 651ss
- **Approach:** N/A

## WO-055: User Story: WO-055 - Inbound Jira Sync Worker Applying Status and Comments
- **Status:** completed
- **Commit:** `7707b35`
- **Files:** 10 (+1295/-0)
- **Duration:** 774ss
- **Approach:** N/A

## WO-056: User Story: WO-056 - Outbound Jira Sync Resilience: Retry, Rate Limit, DLQ
- **Status:** completed
- **Commit:** `cf2a71b`
- **Files:** 14 (+2074/-0)
- **Duration:** 705ss
- **Approach:** N/A

## WO-062: User Story: WO-062 - AI synthesis worker consuming ticket.resolved events
- **Status:** completed
- **Commit:** `08e736e`
- **Files:** 16 (+1602/-0)
- **Duration:** 549ss
- **Approach:** N/A

## WO-067: User Story: WO-067 - Dashboard Aggregate Consumer with Idempotent Redis Counters
- **Status:** completed
- **Commit:** `d72257b`
- **Files:** 22 (+1838/-0)
- **Duration:** 709ss
- **Approach:** Implemented apps/workers/dashboard-aggregator as a NestJS standalone worker following the existing notification-worker scaffolding pattern. The design uses a functional core / imperative shell architecture: pure handler functions (one per event family) return typed Redis mutation command arrays; AggregateStore binds them to Redis via a Lua EVALSHA call that atomically performs the dedup SET NX and all counter mutations in a single round-trip. The Lua script clamps all HINCRBY results to zero to prevent negative counters. ReconcilerService runs every 60 s, executing tenant-scoped Postgres queries inside SET LOCAL app.current_tenant transactions with a 5 s statement timeout, then overwrites Redis and emits per-counter drift gauges. A backwards-compatible CONCURRENTLY migration adds the three partial indexes required for index-backed reconciliation queries.

## WO-081: User Story: WO-081 - Ticket Lifecycle Event Notification Rules and Preferences
- **Status:** completed
- **Commit:** `b633f82`
- **Files:** 17 (+3214/-3)
- **Duration:** 801ss
- **Approach:** N/A

## WO-086: User Story: WO-086 - Portal self-service signup with verified business email domains
- **Status:** completed
- **Commit:** `3a1ab9c`
- **Files:** 11 (+1880/-3)
- **Duration:** 935ss
- **Approach:** N/A

## WO-047: User Story: WO-047 - SLA clock pause, resume and auditable state reconstruction
- **Status:** completed
- **Commit:** `329cac8`
- **Files:** 4 (+435/-0)
- **Duration:** 452ss
- **Approach:** N/A

## WO-048: User Story: WO-048 - Idempotent SLA reminder emission and on-call escalation routing
- **Status:** completed
- **Commit:** `b26363f`
- **Files:** 9 (+1546/-13)
- **Duration:** 793ss
- **Approach:** N/A

## WO-050: User Story: WO-050 - Live SLA countdown components with realtime deltas and polling fallback
- **Status:** completed
- **Commit:** `ae8fa7b`
- **Files:** 7 (+587/-0)
- **Duration:** 604ss
- **Approach:** N/A

## WO-057: User Story: WO-057 - Hourly Jira Link Reconciliation and Event Backfill
- **Status:** completed
- **Commit:** `653e823`
- **Files:** 9 (+1457/-3)
- **Duration:** 487ss
- **Approach:** N/A

## WO-059: User Story: WO-059 - Jira Integration Audit Trail and Sync Observability Instrumentation
- **Status:** completed
- **Commit:** `09d4024`
- **Files:** 9 (+1257/-1)
- **Duration:** 683ss
- **Approach:** N/A

## WO-063: User Story: WO-063 - Per-tenant AI token budget and opt-out policy
- **Status:** completed
- **Commit:** `f362079`
- **Files:** 9 (+975/-9)
- **Duration:** 452ss
- **Approach:** N/A

## WO-064: User Story: WO-064 - Synthesis retry cap, DLQ and operator alerting
- **Status:** completed
- **Commit:** `36a9225`
- **Files:** 12 (+973/-79)
- **Duration:** 575ss
- **Approach:** N/A

## WO-068: User Story: WO-068 - Dashboard Snapshot API with Postgres Fallback Path
- **Status:** completed
- **Commit:** `be0c296`
- **Files:** 4 (+207/-0)
- **Duration:** 341ss
- **Approach:** N/A

## WO-088: User Story: WO-088 - Guided onboarding wizard with resumable progress persistence
- **Status:** completed
- **Commit:** `5487ad3`
- **Files:** 11 (+994/-3)
- **Duration:** 522ss
- **Approach:** N/A

## WO-089: User Story: WO-089 - Portal support request submission with secure attachment uploads
- **Status:** completed
- **Commit:** `a1c6173`
- **Files:** 9 (+785/-13)
- **Duration:** 562ss
- **Approach:** N/A

## WO-098: User Story: WO-098 - Cross-Tenant Isolation and RBAC Negative Test Suite
- **Status:** completed
- **Commit:** `a821284`
- **Files:** 9 (+2636/-0)
- **Duration:** 796ss
- **Approach:** N/A

## WO-065: User Story: WO-065 - Agent-facing AI summary review, edit and regenerate
- **Status:** completed
- **Commit:** `061e8a3`
- **Files:** 3 (+62/-1)
- **Duration:** 233ss
- **Approach:** N/A

## WO-069: User Story: WO-069 - Five-Second Delta Publisher and Sequenced Reconnect Backfill
- **Status:** completed
- **Commit:** `62bf026`
- **Files:** 16 (+1915/-45)
- **Duration:** 1135ss
- **Approach:** N/A

## WO-090: User Story: WO-090 - Portal ticket tracking with public-only comment visibility
- **Status:** completed
- **Commit:** `fb0abf4`
- **Files:** 9 (+1585/-94)
- **Duration:** 673ss
- **Approach:** N/A

## WO-099: User Story: WO-099 - Generate OpenAPI 3.1 Specification From Code
- **Status:** completed
- **Commit:** `f01db50`
- **Files:** 17 (+5611/-2)
- **Duration:** 1103ss
- **Approach:** N/A

## WO-070: User Story: WO-070 - Live Dashboard UI with Countdown Interpolation and Polling Fallback
- **Status:** completed
- **Commit:** `a346516`
- **Files:** 11 (+1346/-2)
- **Duration:** 677ss
- **Approach:** N/A

## WO-091: User Story: WO-091 - Administrator approval queue for pending portal signups
- **Status:** completed
- **Commit:** `36077a8`
- **Files:** 8 (+1211/-1)
- **Duration:** 452ss
- **Approach:** N/A

## WO-102: User Story: WO-102 - Performance And SLO Validation Test Suite
- **Status:** completed
- **Commit:** `6f81f97`
- **Files:** 18 (+3267/-0)
- **Duration:** 853ss
- **Approach:** N/A

## WO-071: User Story: WO-071 - Streaming Pipeline Observability, SLIs and Degradation Alerting
- **Status:** completed
- **Commit:** `b93dd02`
- **Files:** 13 (+1068/-16)
- **Duration:** 461ss
- **Approach:** N/A

## WO-029: User Story: WO-029 - Admin console Organizations page with detail drawer tabs
- **Status:** completed
- **Commit:** `c9efa0b`
- **Files:** 10 (+3203/-0)
- **Duration:** 844ss
- **Approach:** Built the full Organizations management page for the Admin Console within the web-agent app (no separate admin-console bundle exists). Composed the page from: OrganizationsPage (filters + URL sync + table + modals), OrgDetailDrawer (focus-trapped slide-over with lazy-tab-loading), ProfilePanel (pessimistic save with 409/400 handling), ContactsPanel (optimistic portal-toggle with rollback), ScopingPanel (read-only agent scope list), AddCustomFieldModal (dynamic options section for select types), and DeactivateModal (name-match enforcement). All write controls are permission-gated via a canWrite prop derived from server-provided session data. Existing OrgTable and MetadataPanel (already scaffolded) are imported and reused.

## WO-032: User Story: WO-032 - Ticket Creation And Retrieval API Endpoints
- **Status:** completed
- **Commit:** `d80fdd3`
- **Files:** 1 (+551/-0)
- **Duration:** 594ss
- **Approach:** The WO-032 implementation (POST /api/v1/tickets and GET /api/v1/tickets/{id}) was already fully scaffolded in the branch from the blocker WO-031. All core files — tickets.controller.ts, tickets.service.ts, repositories/ticket.repository.ts, dto/create-ticket.dto.ts, dto/ticket-response.dto.ts, tickets.module.ts — were committed and complete. Unit tests (tickets.service.spec.ts) covering AC7 were also in place. The only gap was the supertest integration test (AC8) specifying create-then-read for agent/portal principals across two tenants with cross-tenant 404 assertions. Created apps/api/test/tickets.e2e-spec.ts following the organizations.api.spec.ts pattern: NestJS TestingModule with mocked TicketsService, TestContextInterceptor injecting PrincipalContext via x-test-principal header, supertest assertions for all acceptance criteria.

## WO-033: User Story: WO-033 - Ticket Status Lifecycle And Concurrency-Safe Updates
- **Status:** completed
- **Commit:** `e8a1cee`
- **Files:** 1 (+626/-0)
- **Duration:** 348ss
- **Approach:** All core WO-033 files were pre-committed in the branch from the blocker WO-031: lifecycle/transition-table.ts (declarative transition matrix), lifecycle/ticket-state-machine.ts (pure validateTransition/reachableStatuses), lifecycle/ticket-state-machine.spec.ts (table-driven unit tests), events/ticket-events.ts, dto/update-ticket.dto.ts (strict Zod + version field), dto/resolve-ticket.dto.ts (strict Zod + required resolution_note), tickets.service.ts update()/resolve() with version-guarded UPDATE, status history, outbox events, audit records, and tickets-lifecycle.service.spec.ts covering all AC7 items. The only gap was apps/api/test/ticket-lifecycle.e2e-spec.ts — the supertest integration test named in the work order. Created it following the organizations.api.spec.ts pattern: NestJS TestingModule + mocked TicketsService + TestContextInterceptor injecting PrincipalContext via x-test-principal header. No external DB required.

## WO-034: User Story: WO-034 - Ticket Comment Thread With Visibility Enforcement
- **Status:** completed
- **Commit:** `346831e`
- **Files:** 1 (+769/-0)
- **Duration:** 443ss
- **Approach:** All core WO-034 files were pre-committed in the branch from the blocker WO-031: comments/comments.controller.ts (POST/GET handlers with ZodValidationPipe, portal 403 at service, visibility enforcement in repository), comments/comments.service.ts (create with portal visibility forcing, first_response_at stamping, outbox event, audit; listPage with 404 guard and cursor/limit delegation), comments/create-comment.dto.ts (strict Zod schema, body 1-64000 chars, visibility enum public|internal default public, attachment_ids max 10), comment-response.dto.ts (CommentDto/CommentPageDto), comment-cursor.ts (encodeCommentCursor/decodeCommentCursor with 400 on malformed), repositories/comment.repository.ts, and comments.service.spec.ts (full unit tests). The only gap was apps/api/test/ticket-comments.e2e-spec.ts. Created it following the existing ticket-lifecycle.e2e-spec.ts pattern: NestJS TestingModule + mocked CommentsService + TestContextInterceptor injecting PrincipalContext via x-test-principal header. No external DB required.

## WO-035: User Story: WO-035 - Attachment Upload Via Presigned S3 With MIME Verification
- **Status:** completed
- **Commit:** `a39939c`
- **Files:** 1 (+927/-0)
- **Duration:** 379ss
- **Approach:** All core WO-035 files were pre-committed in the branch from the blocker WO-031: attachments/attachments.controller.ts (AttachmentsController + AttachmentDownloadController — presign/finalize/download handlers), attachments/attachments.service.ts (presign with server-generated key + SSE-KMS policy, finalize with headObject/magic-byte detection/extension cross-check/422 on mismatch + S3 delete, download with 60s TTL, reapOrphans), dto/presign-attachment.dto.ts (strict Zod: filename, mime_type, optional comment_id UUID), dto/finalize-attachment.dto.ts (strict Zod: attachment_id UUID), filename-sanitiser.ts (path traversal/null byte/leading dot stripping + truncation), mime/magic-bytes.ts (MAGIC_TABLE + ALLOWED_EXTENSIONS + validateMimeAndExtension), storage/object-store.port.ts (ObjectStorePort interface), storage/in-memory-object-store.ts (InMemoryObjectStore for tests), storage/s3-object-store.ts, repositories/attachment.repository.ts, filename-sanitiser.spec.ts and magic-bytes.spec.ts (unit tests). The only gap was apps/api/test/attachments.e2e-spec.ts. Created it following the existing ticket-lifecycle.e2e-spec.ts pattern: NestJS TestingModule + mocked AttachmentsService + TestContextInterceptor injecting PrincipalContext via x-test-principal header. Both AttachmentsController and AttachmentDownloadController registered in the TestingModule. No external DB or AWS credentials required.

## WO-040: User Story: WO-040 - Cached Agent Queue Listing With Cursor Pagination
- **Status:** completed
- **Commit:** `3a73a19`
- **Files:** 1 (+888/-0)
- **Duration:** 348ss
- **Approach:** All core WO-040 files were pre-committed in the branch from the blocker WOs: queue/queue.controller.ts (GET /tickets with ZodValidationPipe on QueueQuerySchema), queue/queue.service.ts (listTickets: sort resolution, filter compilation via ViewsService.compileViewForPrincipal, cursor decoding, org-scope predicate via buildRawScopePredicate, Redis page-one cache keyed by tenant+signature+userId+scopeHash+sortKey), queue/queue.repository.ts (single SQL query with LEFT JOIN org, lateral json_agg tags, compiled filter + scope predicate + cursor predicate rebased params, LIMIT n+1 hasMore detection, COUNT with 3s timeout fallback to pg_class.reltuples), queue/queue.dto.ts (QueueQuerySchema: view_id/filter mutually exclusive, limit hard-cap 100, QUEUE_SORTABLE_FIELDS), queue/cursor.ts (encodeCursor, decodeCursor with sort-spec validation, buildCursorPredicate SQL generation, buildOrderByClause), views/view-counts.service.ts (getCounts: compile+count per view, 30s cache keyed by tenant+userId+scopeHash), views/views.controller.ts (GET /views/counts route via ViewCountsService), infra/cache/redis-cache.ts (get/set/del/delPattern with graceful degradation). The only gap was apps/api/test/queue.e2e-spec.ts. Created it following the existing NestJS TestingModule + mocked service + TestContextInterceptor pattern. Both QueueController and ViewsController bootstrapped with mocked QueueService, ViewsService, and ViewCountsService. No DB or Redis required.

## WO-045: User Story: WO-045 - Priority-based SLA target computation and dual timer creation
- **Status:** completed
- **Commit:** `d8cdbb3`
- **Files:** 2 (+959/-0)
- **Duration:** 995ss
- **Approach:** All core WO-045 files were pre-committed in the branch from blocker WOs: domain/sla-target-calculator.ts (pure computeSlaTarget + computeNextFireAt using Intl.DateTimeFormat IANA-aware arithmetic, no getTimezoneOffset), sla-policy-resolver.service.ts (60s Redis cache, null-sentinel for negative hits, invalidateForPolicy for post-write cache busting), sla-timers.repository.ts (insertTimer with ON CONFLICT DO NOTHING, findByTicketId, updateTimer), sla.service.ts (createTimersForTicket + recomputeForPriorityChange with graceful policy-missing degradation and OpenTelemetry counter emission), packages/db/migrations/0028_sla_timers.sql (CREATE TABLE + RLS enable/force + tenant_isolation policy + unique clock index + partial running index), packages/db/src/schema/sla.ts (slaTimers table, SlaTimer, NewSlaTimer types). The only gaps were the two test files: apps/api/test/unit/sla-target-calculator.spec.ts and apps/api/test/integration/sla-timer-creation.spec.ts. Created both following the established Jest mock pattern (no real DB or Redis required).

## WO-049: User Story: WO-049 - SLA policy and escalation settings admin console page
- **Status:** completed
- **Commit:** `7b17f7a`
- **Files:** 1 (+563/-0)
- **Duration:** 893ss
- **Approach:** All WO-049 core files were pre-committed from blocker WOs: SlaSettingsPage, PolicyEditor, TargetsPanel, CalendarPanel, RemindersPanel, PreviewPanel, StickyFooter, SchedulerHealthPill components; TanStack Query hooks (useSlaPolicies, useSlaPolicy, useSaveSlaPolicy, useSlaCalendars, useSchedulerHealth); Zod form schema (slaPolicyFormSchema with superRefine ordering rule); MSW handlers (slaHandlers, resetSlaHandlers); Playwright E2E spec (sla-settings.spec.ts). The only gap was the Vitest component test file. Created apps/web-agent/src/__tests__/sla-settings.test.tsx following the established Sidebar.test.tsx pattern (vi.mock, @testing-library/react, QueryClientProvider). Tests cover: slaPolicyFormSchema pure validation (7 cases), SchedulerHealthPill rendering (9 cases), TargetsPanel validation and read-only (6 cases), RemindersPanel threshold ordering and read-only (7 cases), PolicyEditor tab navigation and error handling (9 cases).

## WO-052: User Story: WO-052 - Jira Project Scoping and Field Mapping Configuration
- **Status:** completed
- **Commit:** `4d90ef6`
- **Files:** 2 (+1091/-0)
- **Duration:** 636ss
- **Approach:** All WO-052 core files were pre-committed from blocker WOs: DB migration (0019_jira_project_mappings.sql) with RLS + partial unique-default index; Drizzle schema (packages/db/src/schema/jira-project-mappings.ts); Zod validation schemas (jira-mapping.schema.ts — fieldMapEntrySchema, statusMapEntrySchema, CreateMappingSchema, UpdateMappingSchema, allow-listed MAPPING_SOURCES); JiraMappingRepository with clearDefault; JiraMappingService (required-field validation via JiraMetadataService, single-default exclusivity, CRUD); JiraMappingResolver (category > org > default precedence, MappingNotFoundError); JiraMetadataService (Redis 15-min cache with force-refresh, stale fallback, getMissingRequiredFields). The gaps were two test files: test/unit/jira-mapping-validator.spec.ts (pure Zod schema tests) and test/integration/jira-mapping.spec.ts (mocked resolver, metadata service, mapping service + AC11 fixtures + DB characterization).

## WO-054: User Story: WO-054 - Signed Jira Webhook Receiver with Idempotent Ingest
- **Status:** completed
- **Commit:** `b417de3`
- **Files:** 2 (+560/-0)
- **Duration:** 546ss
- **Approach:** All WO-054 core files were pre-committed from blocker WOs: apps/jira-webhook-receiver deployable (main.ts, app.module.ts, webhook.controller.ts, signature.verifier.ts, ingest.service.ts, redis.provider.ts, credential-vault.port.ts, package.json, tsconfig.json); unit tests (test/signature.verifier.spec.ts, test/ingest.service.spec.ts); packages/db/src/schema/jira-webhook-events.ts; packages/db/migrations/0020_jira_webhook_events.sql. The gaps were AC10 (integration test) and AC11 (fixtures + signing helper). Created test/fixtures.ts with six real-shape Jira webhook payloads (issue_updated, comment_created, issue_deleted, issue_created, comment_updated, comment_deleted) plus buildSignedHeaders helper and buildResolvedConnection helper. Created test/receiver.integration.spec.ts using NestJS TestingModule + supertest with a mocked IngestService, covering the full HTTP pipeline: all three real fixture payload types, duplicate delivery, unknown event type, missing signature, stale timestamp, tampered body, unknown tenant slug (non-disclosure), oversized payload 413, and 503 on ingest service failure.

## WO-074: User Story: WO-074 - Report Run Preview API And Saved Definition Sharing
- **Status:** completed
- **Commit:** `24fab08`
- **Files:** 5 (+1186/-1)
- **Duration:** 578ss
- **Approach:** All WO-074 service and DTO files were pre-committed from blocker WO-073: ReportRunService (viewer-scope substitution via viewerOrgScopeIds, preview cap, dataAsOf/stale from ReplicaLagProbe, StatementTimeoutError→504, filter-hash logging), ReportDefinitionService (cursor-paginated list with visibility filter, create, optimistic-concurrency update, soft-delete), SharingScopeResolver (private/team/tenant truth table, cross-tenant guard, filterVisible helper), RunReportSchema (exact-one-of definitionId/definition, strict mode), CreateReportDefinitionSchema/UpdateReportDefinitionSchema (version required for update). The gaps were: (1) reports.controller.ts was not pre-committed — created it with @RequirePermission('report:manage') on run/create/update/delete and @RequirePermission('report:read','report:manage') on list; (2) reporting.module.ts did not register the new services/controller — extended it; (3) unit test for SharingScopeResolver + ReportRunService + DTOs (AC9); (4) integration test for HTTP CRUD lifecycle + divergent viewer scope (AC10); (5) fixtures file for Lead/Agent/Manager principals with disjoint org scopes (AC11).

## WO-076: User Story: WO-076 - Streaming CSV Export Worker To S3
- **Status:** completed
- **Commit:** `5c60c56`
- **Files:** 7 (+1446/-1)
- **Duration:** 736ss
- **Approach:** Implemented the full streaming CSV export pipeline for WO-076. The ExportsController (POST /exports → 202 + Location header; GET /exports/:id → presigned URL on-demand) was created following the existing reports.controller.ts RBAC/ZodValidationPipe patterns. The CsvStreamSerializer is a Node.js Transform stream that never accumulates rows — it emits UTF-8 BOM + RFC 4180-compliant CSV with CRLF line endings, formula-injection neutralisation, and a zero-row _flush guard. The ExportWorker consumes the SQS queue with an idempotency guard (conditional markProcessing WHERE status='queued' RETURNING id; null = redelivery no-op), streams rows from the replica via pg-query-stream (batchSize=1000), enforces the 500k row cap with truncated=true on overflow, and pipes into an S3 lib-storage Upload (8MB parts, queueSize=2, SSE-KMS) to keep peak RSS well under 128MB. reporting.module.ts was extended to register ExportsController, ExportRequestService, ExportJobsRepository, and PresignedUrlService.

## WO-085: User Story: WO-085 - Notification Retention Purge and CSAT Erasure Compliance
- **Status:** completed
- **Commit:** `e4da321`
- **Files:** 12 (+1940/-1)
- **Duration:** 746ss
- **Approach:** WO-085 builds on the pre-committed retention registry, partition-maintenance, and batch-delete packages from blocker WOs. The implementation gap was: (1) the RetentionJob (distributed Redis lock, per-table iteration over drop_partition and batch_delete strategies, retention_job_runs recording, structured metrics emission) and WorkerModule for the retention-worker app; (2) SubjectDataEraser contributors for notifications (tombstone recipient_email + clear payload), csat_surveys (tombstone comment + null contact_id preserving score for AC6), and webhook_deliveries (tombstone canonical_payload + response_snippet); (3) AdminRetentionController with GET /admin/retention/status and GET /admin/privacy/erasure-receipts/:requestId behind privacy:manage; (4) privacy.module.ts extended to register AdminRetentionController; (5) anonymised test-seed factories for notifications (example.invalid emails) and CSAT (synthetic comment corpus); (6) unit tests covering registry completeness, horizon computation across month/DST boundaries, erasure field enumeration completeness, tombstone constants, and anonymisation lint; (7) integration tests covering all admin endpoint shapes, erasure receipt completeness, CSAT score preservation (AC6), and RetentionJob lock guard idempotency.

## WO-095: User Story: WO-095 - Retention Policy Engine and Automated Purge Worker
- **Status:** completed
- **Commit:** `09ab780`
- **Files:** 11 (+2235/-6)
- **Duration:** 818ss
- **Approach:** WO-095 implements the Retention Policy Engine and Automated Purge Worker. Built on the pre-committed retention-registry, partition-maintenance, and batch-delete from packages/retention (WO-085 blockers). The gap was: (1) DB migrations for retention_policies (CHECK-enforced bounds, 365-day audit floor, block-mutation trigger), purge_runs (append-only immutable ledger), and subject_data_keys (wrapped DEK for crypto-shred); (2) Drizzle schema additions for all three tables; (3) RetentionPolicyService with CRUD validation and startup consistency check; (4) retention-horizon.ts with pure horizon computation, partition eligibility selection, and straddling-partition safety; (5) PartitionPurger with DETACH PARTITION CONCURRENTLY + DROP in separate txn and orphan recovery; (6) BatchPurger with FOR UPDATE SKIP LOCKED, statement_timeout, and inter-batch yield; (7) CryptoShredService with double-erasure idempotency and dry-run projection; (8) PurgeWorker with PostgreSQL advisory lock, dry-run default, per-category failure isolation, 500k row cap, and structured Prometheus metrics; (9) 14-month multi-tenant seed fixture generator; (10) comprehensive unit + integration tests covering all AC criteria.

## WO-096: User Story: WO-096 - Compliance Audit Query and Subject Data Export API
- **Status:** completed
- **Commit:** `51628c1`
- **Files:** 4 (+1511/-0)
- **Duration:** 665ss
- **Approach:** All controller, service, DTO, and migration files for WO-096 were already committed from blocker WOs (WO-006, WO-020). The implementation gap was: (1) SubjectExportWorker — the SQS-consumed worker that assembles a GDPR subject export archive and streams NDJSON to S3 via lib-storage multipart upload with SSE-KMS, idempotency guard via markRunning(), manifest-driven per-table iteration with portal visibility filter, and leavePartsOnError: false; (2) audit query-seed fixtures — 10 multi-tenant audit log rows, a deliberately tampered chain, and subject fixtures (ticket, public comment, internal comment, CSAT) with constants for expected export table lists; (3) audit-query.spec.ts integration tests covering AC1–AC5 and AC9–AC10 with mocked AuditQueryService; (4) subject-requests.spec.ts integration tests covering AC6–AC12 with mocked SubjectRequestService and manifest completeness unit tests. The SubjectExportWorker uses buildSubjectExportManifest(isPortalPrincipal) to structurally exclude internal notes from portal exports at the SQL layer (visibilityFilter predicate), and enforces tenant namespacing in the S3 key (subjects/{tenantId}/{requestId}/export.ndjson). All values are positional parameters; no user input is interpolated into SQL.

## WO-101: User Story: WO-101 - End-to-End Critical Journey and Accessibility Regression Suite
- **Status:** completed
- **Commit:** `b3daf46`
- **Files:** 0 (+0/-0)
- **Duration:** 340ss
- **Approach:** All WO-101 files were pre-committed to the branch from blocker WOs (WO-007 and WO-083). The entire end-to-end regression suite exists in test/e2e/ as a complete, ready-to-run Playwright suite. The suite: (1) playwright.config.ts — three Playwright projects (agent, admin, portal) with parallel workers, trace/screenshot/video on failure, JUnit reporter, CI-aware retries, and npm scripts for smoke/full/synthetic invocations; (2) state-polling utility (eventual.ts) — exponential back-off eventually() and eventualValue() with descriptive failure messages, plus computeExpectedQueue() for independent queue-set verification; (3) page objects — TicketListPage, TicketDetailPage, DashboardPage, SavedViewBuilderPage, AdminOrganizationsPage, PortalSubmitTicketPage, all encapsulating raw selectors; (4) deterministic stubs — InferenceStub (success/forced_failure modes), JiraStub (records requests, emits signed webhooks), MailCaptureStub (captures emails, waitForMessage, extractLink); (5) journey specs — ticket-lifecycle, sla-pause-resume-reminders, jira-round-trip, ai-synthesis-and-csat, dashboard-realtime, report-export, saved-view — all using eventually() not page.waitForTimeout(); (6) accessibility suite — keyboard-navigation.spec.ts with AxeBuilder wcag2a/2aa/21a/21aa scans + keyboard-only assertions for focus order, focus trap, and modal escape; (7) unit tests for the polling utility and stubs; (8) committed Jira webhook fixture with HMAC-SHA256 signed payloads.

## WO-030: User Story: WO-030 - Organization change audit trail and history API
- **Status:** completed
- **Commit:** `85cc31a`
- **Files:** 2 (+806/-0)
- **Duration:** 694ss
- **Approach:** All WO-030 write-path and schema files were pre-committed from blocker WOs (WO-027, WO-029): AuditWriter, org-audit-diff utility (buildDiffEntries + maskOrgPiiSnapshot + ORG_PII_FIELDS), OrganizationAuditController (GET list + GET export with AUDIT_EXPORT_ROW_CAP=10,000 and OrgAuditQuerySchema strict Zod), the audit_logs migration with monthly partitioning and REVOKE UPDATE/DELETE/TRUNCATE, and the org-audit-diff.spec.ts unit tests. This WO adds the missing integration test surface: (1) audit-logs.seed.ts — 7 deterministic AuditLogRow fixtures spanning Jan/Feb/Mar 2024 across staff/machine/portal actors and create/update/deactivate/reactivate/contact.create/contact.update operations, plus a buildExportCapRows() helper for cap-exceeded testing; (2) organization-audit.api.spec.ts — NestJS TestingModule + supertest + mocked AuditQueryService and OrganizationsRepository, covering the full read-API surface without a live database.

## WO-041: User Story: WO-041 - Agent Workspace Queue Interface With SLA Countdowns
- **Status:** completed
- **Commit:** `a4d598e`
- **Files:** 1 (+275/-0)
- **Duration:** 444ss
- **Approach:** All WO-041 queue feature files were pre-committed to the branch from blocker WOs (WO-040 and WO-038). The complete queue surface is present: QueuePage.tsx (views rail + filter bar + virtualised table + bulk actions + save modal layout with SlaClockProvider), ViewsRail.tsx (system views, pinned views, live count badges, pin/unpin, drag reorder), FilterChipBar.tsx (chip per active condition, Clear all, +Add filter trigger), AddFilterDrawer.tsx (FIELD_REGISTRY-constrained field/operator/value picker), TicketTable.tsx (virtualised fixed-row-height table with SlaCountdown from @opsninja/ui-kit, priority badges, category path, org, assignee, tag chips, Jira link indicator, keyboard arrow-key navigation), BulkActionBar.tsx (chunked concurrent submission, per-row success/failure reporting), SaveViewModal.tsx (name, scope, columns, sort; POST /views → immediate rail update), useBulkSelection.ts (TOGGLE/SELECT_ALL/CLEAR/RANGE_TO/SET_PAGE reducer), lib/api/tickets/hooks.ts (useTicketQueue infinite query, flattenQueuePages, detectStaleResultSet, useBulkAction), lib/api/tickets/types.ts (TicketRow, TicketListResponse, BulkAction types), lib/mocks/handlers/queue.ts (MSW handlers for GET /tickets, GET /views/counts, GET /views, POST /views, PATCH /tickets/bulk), e2e/queue.spec.ts (Playwright journey: render, filter, bulk-assign, save view, reload), e2e/queue-sla.spec.ts (SLA countdown a11y, icon+text labels, aria-live), tests/sla-queue.spec.ts (countdown visual checks), test/unit/queue.test.tsx (bulkSelectionReducer, flattenQueuePages, detectStaleResultSet, FilterChipBar, FIELD_REGISTRY). The one gap was countdown interpolation unit tests (AC9): created apps/web-agent/test/unit/countdown.test.ts covering computeCountdown (running/paused/breached), classifyDisplayState (all 4 states), formatRemainingMs, and formatRemainingShort with 22 test cases using injected nowMs (no fake timers needed).

## WO-042: User Story: WO-042 - Ticket Detail Workspace And Resolve Modal
- **Status:** completed
- **Commit:** `a3b4650`
- **Files:** 0 (+0/-0)
- **Duration:** 137ss
- **Approach:** All WO-042 ticket detail workspace files were pre-committed to the branch from blocker WOs (WO-040, WO-032). The complete detail surface is present: TicketDetailPage.tsx (header with ticket number/status/priority/org, property sidebar, conversation thread, attachment list, SLA timeline, Jira card, resolve trigger), ConversationThread.tsx (cursor-paginated mixed-visibility thread with structurally distinct internal-note rendering, aria-label announcement, scroll-position preservation), CommentComposer.tsx (public/internal visibility toggle, canPostInternal permission guard, optimistic append, empty-body guard), PropertySidebar.tsx (category/priority/assignee/tags/custom fields, version-aware PATCH, conflict banner with reload-and-merge on 409, edits preserved), AttachmentUploader.tsx (idle→presigning→uploading→finalizing→done/failed state machine, progress reporting, per-file retry), SlaTimelineCard.tsx (elapsed+paused+remaining segments, 50%+75% reminder markers from SLA summary payload), JiraLinkCard.tsx (linked issue key/status, create-issue action, graceful disabled state when tenant has no Jira connection), ResolveModal.tsx (required resolution note, focus-trapped dialog, AI pending/ready/failed states, editable affected-area tags, CSAT trigger notice), conflictReducer.ts (EDIT/SAVE_SUCCESS/SAVE_CONFLICT/MERGE/DISMISS_CONFLICT/RESET reducer), MSW handlers (ticket-detail.ts: detail, mixed-visibility threads, presign/finalize, AI state sequences), e2e/ticket-detail.spec.ts (8 Playwright scenarios + Axe scan), test/unit/ticket-detail.test.tsx (5 describe blocks, 305 lines covering all AC9 criteria). Working tree is clean — no gaps.

## WO-043: User Story: WO-043 - Ticketing Isolation, E2E And Accessibility Test Suite
- **Status:** completed
- **Commit:** `7094b72`
- **Files:** 0 (+0/-0)
- **Duration:** 292ss
- **Approach:** All WO-043 ticketing isolation, E2E and accessibility test suite files were pre-committed to the branch from blocker WOs (WO-040, WO-033, WO-006). The complete suite is present: packages/db/test/fixtures/shared-seed.ts (373 lines — 2 tenants, 4 orgs, 3 scoped agents, portal user, DevOps taxonomy, tags, groups, saved views, mixed-visibility threads with all SHARED_IDS as fixed-format UUIDs), apps/api/test/isolation/table-matrix.spec.ts (315 lines — enumerates tickets-module tables from pg_class, asserts FORCE ROW LEVEL SECURITY + tenant predicate policy, cross-tenant SELECT/UPDATE/DELETE produces zero rows), apps/api/test/isolation/route-matrix.spec.ts (307 lines — iterates ticketing routes from generated OpenAPI spec, asserts 404 for cross-tenant requests with no existence disclosure), apps/api/test/isolation/org-scope.spec.ts (258 lines — out-of-scope agent cannot list/read/comment/assign/resolve org2 tickets), apps/api/test/isolation/portal-visibility.spec.ts (323 lines — portal responses contain no internal content, defence-in-depth run with app predicate disabled proves RLS alone holds), apps/api/test/e2e/ticket-lifecycle.spec.ts (402 lines — full lifecycle journey with audit record + outbox event multiset assertions and fault-injection mutation tests), apps/api/test/support/principals.ts (186 lines — typed principal factories, buildOrgAccessMatrix, principalHasOrgAccess), apps/api/test/unit/suite-helpers.spec.ts (254 lines — unit tests for all helper utilities per AC8), apps/api/test/isolation/resource-matrix.ts (414 lines — route resource matrix generator). Working tree is clean — no gaps.

## WO-046: User Story: WO-046 - Durable SLA timer scheduler worker with claim-and-fire loop
- **Status:** completed
- **Commit:** `6e0b684`
- **Files:** 1 (+897/-0)
- **Duration:** 532ss
- **Approach:** All WO-046 SLA scheduler worker files were pre-committed to the branch from blocker WO-045: apps/api/src/workers/sla-scheduler/ (boundary-classifier.ts, boundary-classifier.spec.ts, health.controller.ts, main.ts, scheduler.module.ts, scheduler.service.spec.ts, scheduler.service.ts, timer-claim.repository.ts), docs/adr/sla-scheduler-rls-claim-pattern.md, and packages/db/migrations/0031_sla_scheduler_role.sql. The one gap was apps/api/test/integration/sla-scheduler.spec.ts (AC12 integration tests + AC13 timer fixtures). Created this file (897 lines) with: (1) 7 deterministic timer fixture constants exported at each boundary position (pre-first-reminder, at-first-reminder, between-reminders, at-second-reminder, pre-breach, at-breach, past-breach) for a 4-hour SLA with 50%/75% thresholds; (2) 36 mock-based tests covering AC2 (per-tenant SET LOCAL before every tenant-scoped query, called once per timer across three tenants in one tick), AC4 (reminder outbox payload: tenantId/timerId/ticketId/clockType/boundary/thresholdPct/targetAt), AC5 (breach: state→breached, nextFireAt→null, sla.breached event type), AC6 (SKIP LOCKED simulation: second pod sees empty batch, recordFiredBoundary=false prevents duplicate outbox write), AC7 (mid-tick crash: ROLLBACK called on commit failure, client.release always called), AC10 (terminal ticket→met no outbox, deleted policy→cancelled no outbox), AC12 (full 3-tenant tick: exactly 3 outbox events, correct advance calls, catch-up fires all missed boundaries in order, COMMIT always called), AC8 (getLagSeconds, isReady thresholds), AC13 (all 7 fixture timers classified correctly via classifyDueBoundaries, lag metric for past-breach = 1800s); (3) DB-backed placeholder tests in maybeDescribe (skip without DATABASE_URL) covering RLS fail-closed, SKIP LOCKED, crash recovery, sla_fired_boundaries uniqueness, and readiness probe.

## WO-053: User Story: WO-053 - Escalate Ticket to Jira Issue and Persist Link
- **Status:** completed
- **Commit:** `9669a4f`
- **Files:** 4 (+1478/-0)
- **Duration:** 806ss
- **Approach:** All WO-053 source files were pre-committed from blocker WOs (WO-052, WO-005): jira-links.controller.ts, jira-links.service.ts, jira-payload.builder.ts, jira-links.dto.ts (EscalateLinkSchema Zod strict), ticket-jira-links Drizzle schema + migration, JiraLinkCard.tsx, CreateJiraIssueModal.tsx. The gap was 4 test/fixture files. Created: (1) jira-links.fixtures.ts — deterministic IDs (JL_TENANT_A/B, JL_AGENT_A/PORTAL_A/ADMIN_A, JL_TICKET_ID, JL_MAPPING_ID, JL_CONNECTION_ID, JL_LINK_ID), all 4 principal types (agent/admin/portal/cross-tenant), 3 mapping variants (enabled-public, enabled-internal, disabled), 5 comment fixtures (public, internal, oversized 2500-char, HTML-special, second-public), 6 ticket context variants, 4 link state rows (pending/linked/failed/unlinked), ADF snapshot helpers. (2) jira-payload-builder.spec.ts — 25 unit tests covering: ADF doc structure (type, version, heading levels, bullet-list items), internal note exclusion (default=excluded), defence-in-depth (mapping.syncRules.commentVisibility gates internal notes even when caller requests them), BOTH-flags-must-be-set to include internal notes, oversized comment truncation with truncation marker, HTML escaping in comment bodies + subject + org name, no-comment thread omits Recent Comments section, ticketNumber null → ticketId fallback, MAX_COMMENTS limit, non-ASCII/emoji pass-through. (3) jira-links.spec.ts — NestJS TestingModule + supertest integration tests with TestContextInterceptor bypassing AuthGuard, mocked JiraLinksService; covers AC2 (202 + pending link, no Jira HTTP, linkExisting), AC3 (422 JIRA_LINK_OUT_OF_SCOPE, missing issueKey, bad format), AC4 (409 JIRA_LINK_ALREADY_EXISTS body code), AC5 (GET 200 data array), AC6 (DELETE 204, correct args), retry 202, AC9 strict Zod (unknown field/missing mappingId/invalid mode), AC10 (portal 403 via ForbiddenException, atomic failure → 500 with no stack trace, DB-backed maybeDescribe stubs). (4) JiraLinkCard.test.tsx — Vitest + @testing-library/react; covers AC7: not-configured renders text+no-button+aria-label 'Jira integration', linked renders issueKey hyperlink+status+summary+target=_blank+aria-label 'Jira issue', no-link renders create button, isCreating disables button+shows 'Creating…'+aria-busy=true, onCreateIssue fires on click, does NOT fire when disabled.

## WO-058: User Story: WO-058 - Jira Integration Console for Connection and Sync Health
- **Status:** completed
- **Commit:** `ce5d2b4`
- **Files:** 7 (+2139/-0)
- **Duration:** 797ss
- **Approach:** All backend WO-058 files were pre-committed from blocker WOs: jira-health.controller.ts (GET /integrations/jira/health with jira:read/jira:manage, POST connections/:id/webhook-secret/rotate with jira:manage), jira-health.service.ts (aggregated health payload: connections from DB, 24h event stats, Redis lag p95 + rate budget, short 10s server-side cache, graceful degradation with stale:true), jira-health.dto.ts, lib/api/jira/types.ts (full type tree: health, connections, mappings, DLQ, reconciliation, audit), lib/api/jira/hooks.ts (useJiraHealth 15s poll, useTestConnection, useRotateWebhookSecret, useJiraProjects, useJiraFields, useJiraMappings, useSaveMapping, useDlqPage infinite-query, useReplayDlqItem, useReplayDlqBatch DLQ_BATCH_REPLAY_CAP=50, useReconciliationRuns 15s poll, useTriggerReconciliation), ConnectionCard.tsx, HealthStrip.tsx, MetricTile.tsx, WebhookPanel.tsx, MappingEditor.tsx, and navConfig entry at /jira-integration for integration_admin/admin roles. The gaps were: (1) DlqTable.tsx — cursor-paginated table with filter-by-event-type, per-row select, select-all, capped batch replay with confirmation dialog, single replay with toast, aria-live toast region for per-item outcomes, stale badge; (2) ReconciliationPanel.tsx — run list with outcome chips, counts, duration, lookback window; trigger button with lookback selector; disabled while a run is active; audit ID surfaced on success; (3) JiraIntegrationPage.tsx — page shell composing all panels; first-run empty state; 403 detection; connection picker tabs for multi-connection; (4) app/(app)/jira-integration/page.tsx — Next.js App Router route; (5) lib/mocks/handlers/jira-integration.ts — MSW handlers for all 14 Jira integration endpoints + mutable state setters + 8 fixture constants + MOCK_HEALTH_* / MOCK_DLQ_* / MOCK_RECON_* / MOCK_PROJECTS / MOCK_FIELDS / MOCK_MAPPINGS / MOCK_MAPPING_VALIDATION_ERROR_RESPONSE; (6) test/unit/JiraIntegrationConsole.test.tsx — 45 component tests across MetricTile, ConnectionCard, HealthStrip, JiraIntegrationPage, DlqTable, ReconciliationPanel, WebhookPanel, and AC8/AC9/AC11 end-to-end flows; (7) browser.ts extended to include jiraHandlers.

## WO-062: User Story: WO-062 - AI synthesis worker consuming ticket.resolved events
- **Status:** completed
- **Commit:** `98355a7`
- **Files:** 3 (+1304/-0)
- **Duration:** 755ss
- **Approach:** All WO-062 source files were pre-committed from blocker WOs: synthesis.service.ts (two-transaction orchestration, deduplicateAreas, markFailedPermanent, MAX_ATTEMPTS=3), synthesis.consumer.ts (SQS long-poll, batch size 5, visibility 120s, KEDA queue-depth metric, SIGTERM drain), thread-loader.ts (DB reads via RLS-bound client, chronological ordering, MAX_CHARS truncation), idempotency.repository.ts (INSERT...ON CONFLICT DO NOTHING keyed on tenant_id+event_id, 7-day TTL), llm-provider.port.ts (LlmProviderPort, RetryableLlmError, NonRetryableLlmError), ai-policy.port.ts (AiPolicyPort, PermissiveAiPolicy), metrics.ts (emitAttemptMetric, emitLagMetric), bedrock-llm.adapter.ts, db-ai-policy.ts, worker.module.ts, main.ts, packages/db/src/schema/ai-synthesis.ts. The gaps were test files. Created: (1) fixtures.ts — deterministic UUIDs (AS_TENANT_A/B, AS_TICKET_1/12/30_COMMENT, AS_EVENT_ID_1/2/3), SynthesisRequest fixtures for 1-comment, 12-comment (mixed public+internal), 30-comment, internal-only, no-comment, Tenant B tickets, SynthesisResult fixtures including one with case/whitespace duplicate areas; (2) synthesis.service.spec.ts — FakePool/FakePoolClient/FakeLlmProvider/FakeIdempotency/FakeThreadLoader/FakeAiPolicy, 35 unit tests covering all outcome transitions, area dedup, idempotency x3 deliveries, skip path, retryable/non-retryable LLM errors, attempt cap, markFailedPermanent outbox, Tx-1-before-LLM-call ordering, zero-comment ticket; (3) synthesis.integration.spec.ts — 16 mock-backed integration tests (always run) covering full happy path, tenantId isolation, pool client release, cross-tenant context separation, Tx-2 crash redelivery, closure independence, concurrent idempotency, outbox payload shape, audit record content; plus 6 DB-backed maybeDescribe stubs for Testcontainers-gated assertions.

## WO-067: User Story: WO-067 - Dashboard Aggregate Consumer with Idempotent Redis Counters
- **Status:** completed
- **Commit:** `7ed11bf`
- **Files:** 2 (+1034/-0)
- **Duration:** 492ss
- **Approach:** All WO-067 source files were pre-committed from blocker WOs: sqs-consumer.service.ts (SQS long-poll consumer routing 12 event types via routeEvent(), KEDA queue-depth metric, graceful SIGTERM drain), outbox-event.schema.ts (Zod OutboxEventSchema + typed payloads + parseOutboxEvent SNS-unwrapper), redis/keys.ts (dash:{tenant}:kpi/category/affected_area/org_load/breach_risk/feed/meta namespacing, FEED_MAX=100, DEDUP_TTL_SECONDS=604800), redis/aggregate.store.ts (AggregateStore with SCRIPT LOAD + EVALSHA, applyEvent atomicity via Lua, overwriteKpi/overwriteZset for reconciler), redis/lua/apply-event.lua (SET NX dedup + HINCRBY clamp-at-zero + ZINCRBY/ZADD/ZREM/LPUSH/LTRIM/HSET + meta seq increment), handlers/ticket-events.handler.ts (handleTicketCreated/PriorityChanged/ClosedOrResolved/Reopened/Updated), handlers/sla-events.handler.ts (handleSlaTimerStarted/Paused/Resumed/ThresholdReached/Breached), handlers/ai-events.handler.ts (handleAiSynthesisCompleted — only aiStatus=succeeded), reconcile/reconciler.service.ts (ReconcilerService 60s interval, SET LOCAL statement_timeout+app.current_tenant, KPI recompute, drift measurement, overwriteKpi, needsSnapshot flag), observability/pipeline.metrics.ts (pipeline metrics with tenant_bucket cardinality cap), worker.module.ts, main.ts. Pre-committed test/spec files: ticket-events.handler.spec.ts, sla-events.handler.spec.ts, ai-events.handler.spec.ts, outbox-event.schema.spec.ts, redis/aggregate.store.spec.ts, publish/aggregate-diff.spec.ts, publish/delta-publisher.service.spec.ts, test/fixtures/outbox-events.fixtures.ts, test/fixtures/frame-sequence.fixtures.ts. Gaps filled: (1) reconciler.service.spec.ts — unit tests for ReconcilerService using FakePool/FakeRedis/FakeAggregateStore; (2) test/consumer.integration.spec.ts — full 7-step lifecycle integration test + dedup/namespacing/feed-cap/breach-risk/poison-message assertions + maybeDescribe DB stubs.

## WO-075: User Story: WO-075 - Scheduled Report Delivery With Idempotent Dispatch
- **Status:** completed
- **Commit:** `da050ec`
- **Files:** 5 (+1772/-0)
- **Duration:** 955ss
- **Approach:** All WO-075 source files were pre-committed from blocker WOs: cron-next-fire.ts (IANA-aware cron calculator with computeNextFireAt, validateMinimumInterval, buildOccurrenceKey, parseCronExpression, CADENCE_PRESETS, CronParseError, CronIterationLimitError), recipient-policy.ts (RecipientPolicy with default-deny, validateRecipients throwing 422 RECIPIENT_DOMAIN_NOT_ALLOWED / SCHEDULE_RECIPIENTS_EMPTY, classifyRecipients resolving users + verified domains + allowlist), report-schedules.controller.ts (Lead-gated CRUD with ZodValidationPipe), report-schedules.service.ts (assertValidCron, resolveCronExpression, create/update/delete with audit records), report-schedules.repository.ts (claimDueSchedules FOR UPDATE SKIP LOCKED, insertOccurrence ON CONFLICT DO NOTHING, advanceSchedule), packages/db schema (report_schedules, report_schedule_occurrences unique occurrence_key index, external_recipient_allowlist with RLS). Gaps filled: (1) src/workers/report-scheduler/report-scheduler.worker.ts — 60s tick worker using pg.Pool directly, claimDueSchedules() with BEGIN/SELECT FOR UPDATE SKIP LOCKED LIMIT 200/COMMIT, processSchedule() with per-tenant BEGIN/SET LOCAL app.current_tenant/INSERT occurrence ON CONFLICT DO NOTHING/INSERT outbox report.schedule.fired/UPDATE report_schedules/COMMIT, advanceSchedule() using computeNextFireAt disabling the schedule on CronParseError, SpyMetrics port, ClockFn port, SIGTERM drain; (2) domain/cron-next-fire.spec.ts — 35 unit tests covering parseCronExpression (step/range/comma/dow-normalisation), validateMinimumInterval (sub-hourly rejection, exactly-1h acceptance), computeNextFireAt across America/New_York spring-forward 2024-03-10 (02:30 → 03:00 EDT, fires once), fall-back 2024-11-03 (01:30 repeated hour fires once), Europe/London spring-forward 2024-03-31, America/Los_Angeles spring-forward, UTC baseline expressions, buildOccurrenceKey determinism/minute-truncation/cross-tenant/cross-schedule, CronIterationLimitError on impossible expression; (3) domain/recipient-policy.spec.ts — 20 unit tests covering allowlisted email (case-insensitive), verified domain (case-insensitive), default-deny for non-matching domain, active/inactive users, missing userId/email fields, empty list SCHEDULE_RECIPIENTS_EMPTY, mixed allow+deny, multiple verified-domain recipients, DB repository call assertions; (4) test/fixtures/report-scheduler.fixtures.ts — deterministic UUIDs, ClaimableSchedule rows for America/New_York daily (pre/post DST), Europe/London weekly, UTC monthly, America/Los_Angeles daily, spring-forward (02:30 skipped), fall-back (01:30 repeated), verified/non-verified/allowlisted/user recipient sets, makeSchedule() builder, StubSesTransport recording sent messages; (5) test/integration/reporting/report-scheduler.spec.ts — FakePoolClient (records all queries, failNextContaining injection), FakePool, ConflictingFakePoolClient (returns 0 rows on occurrence INSERT simulating ON CONFLICT), SpyMetrics spy; 30 mock-backed tests: happy path occurrence+outbox in one txn, SET LOCAL before DML, occurrence_key matches buildOccurrenceKey, outbox payload shape, client release, UPDATE inside same txn, duplicate suppression (no outbox, still advances), error path ROLLBACK+release, next_fire_at recomputation in UTC and America/New_York, DST-spanning fixture parametrised loop (5 schedules × 2 assertions = 10), idempotency across 3 deliveries (outbox once), cross-tenant isolation, claimDueSchedules FOR UPDATE SKIP LOCKED LIMIT structure, ROLLBACK on claim failure; 5 DB-backed maybeDescribe stubs for real unique-constraint enforcement, SKIP LOCKED disjoint claim, forced SQS redelivery no second outbox, auto-disable on deleted definition, RLS isolation.

## WO-077: User Story: WO-077 - Sandboxed Chromium PDF Report Renderer
- **Status:** completed
- **Commit:** `e9b8284`
- **Files:** 4 (+1441/-0)
- **Duration:** 764ss
- **Approach:** Implemented a sandboxed headless Chromium PDF renderer as a standalone class (PdfRenderWorker) sharing the ExportJobsRepoPort lifecycle interface with the CSV worker. The worker uses injected BrowserPagePort/BrowserInstancePort ports for testability without real Chromium. Key design choices: (1) single Chromium instance per pod with lazy init and isConnected() restart detection, (2) queue-based mutex (acquireRenderLock/releaseRenderLock) serialising renders to bound peak RSS to ~1 GB, (3) Promise.race with a 45-second timeout and page.close() in finally, (4) replica query with LIMIT cap+1 overflow detection for row cap enforcement, (5) S3 SSE-KMS multipart upload via lib-storage, (6) classifyPdfError mapping all error types to canonical error codes. The Dockerfile uses the Playwright/Node 20 base image, bundles ECharts from the local npm package (never CDN), creates uid 1001 non-root user, documents Chromium hardening flags and NetworkPolicy egress restrictions. All report data passes through escapeHtml() inside report-pdf.template.ts (pre-committed) — the worker never interpolates raw values. Integration tests cover hostile-content escaping (FORBIDDEN_RENDERED_PATTERNS), job lifecycle, idempotency, row cap, timeout, browser restart, and concurrency serialisation.

## WO-078: User Story: WO-078 - Report Builder Workspace UI For Support Leads
- **Status:** completed
- **Commit:** `9782246`
- **Files:** 2 (+476/-0)
- **Duration:** 465ss
- **Approach:** All core WO-078 files were pre-committed from the initial scaffold (blocker WOs WO-074 and WO-076): ReportBuilderPage.tsx, BuilderPanel, SavedReportsRail, MetricPicker, GroupBySelect, VisualizationToggle, FilterStack, FilterRow, RowLimitNote, PreviewPanel, RunStatePill, ExportBar, ExportJobsCard, ScheduleModal, builder.reducer.ts (TOGGLE_METRIC/SET_GROUP_BY/ADD_FILTER/UPDATE_FILTER/REMOVE_FILTER/MARK_RUN/MARK_SAVED/LOAD_DEFINITION/MARK_CLEAN actions), buildFilterAst, canRun, canSave, TanStack Query hooks (useFieldCatalog 1h staleTime, useReportList, useRunReport with AbortController, useCreateReport, useUpdateReport, useDeleteReport), reporting types (FilterAst, ChartType, ReportScope, getErrorCopy), MSW handlers (MOCK_FIELD_CATALOG, MOCK_DEFINITIONS, MOCK_RUN_RESULT, MOCK_RUN_TRUNCATED, setRunBehaviour, resetReportingHandlers, reportingHandlers wired into browser worker), and Vitest unit tests (reporting.test.tsx — 50+ tests covering reducer, buildFilterAst golden output, FilterRow operator/type matrix, RunStatePill 6 states, RowLimitNote truncation/stale/replica, role gating, error copy mapping). The two implementation gaps: (1) BuilderPanelProps interface was missing onExportCsv/onExportPdf optional handlers that are passed at the usage site (ExportBar handles exports internally; parent passes them for optional override) — fixed by adding the optional props to the interface; (2) Playwright e2e test (AC-12) was absent — created e2e/report-builder.spec.ts with 9 tests covering the full build-run-save-reopen journey plus axe assertions in light and dark themes.

## WO-081: User Story: WO-081 - Ticket Lifecycle Event Notification Rules and Preferences
- **Status:** completed
- **Commit:** `991d889`
- **Files:** 1 (+687/-0)
- **Duration:** 783ss
- **Approach:** All WO-081 source files were pre-committed on the branch (event-catalogue.ts, notification-rule.resolver.ts, notification-preferences.service.ts, notification-preferences.controller.ts, dto/notification-preferences.dto.ts, notifications.module.ts, and all unit test files). The single gap was the integration test. Created apps/api/test/integration/notification-preferences.spec.ts following the NestJS TestingModule + supertest + mocked-service pattern established by organizations.api.spec.ts and portal-ticket-isolation.spec.ts. The file has two major sections: (1) HTTP API endpoint tests for AC-5 using TestContextInterceptor (reads x-test-principal header, binds requestContextStore) with PortalVisibilityGuard overridden to always pass; (2) rule resolver behaviour tests for AC-3/AC-9 using direct resolver instantiation with getTxHandle mocked via jest.mock. The resolver section mocks getTxHandle to return a Drizzle-shaped query stub for the two DB calls (ticket lookup + contacts query), allowing all short-circuit paths and full-pipeline paths to be exercised without a real database.

## WO-086: User Story: WO-086 - Portal self-service signup with verified business email domains
- **Status:** completed
- **Commit:** `9f78a28`
- **Files:** 0 (+0/-0)
- **Duration:** 254ss
- **Approach:** N/A

## WO-100: User Story: WO-100 - Publish Developer Portal and Outbound Webhook Catalogue
- **Status:** completed
- **Commit:** `472019c`
- **Files:** 1 (+79/-0)
- **Duration:** 752ss
- **Approach:** All WO-100 files were pre-committed on the branch. The implementation establishes a single typed event-type registry (packages/events/src/event-registry.ts) as the authoritative source for all 7 outbound webhook events (ticket.created, ticket.updated, ticket.closed, ticket.comment_added, ticket.sla_breached, ticket.assigned, webhook.ping), each with payloadSchema, examplePayload, trigger, orderingCaveat, dataClassification, and availability. Delivery configuration constants (MAX_WEBHOOK_DELIVERY_ATTEMPTS=6, WEBHOOK_BACKOFF_DELAYS_SECONDS=[1,2,4,8,60,900], SIGNATURE_REPLAY_WINDOW_SECONDS=300, WEBHOOK_CONSUMER_TIMEOUT_SECONDS=30) live in a single delivery-config.ts consumed by the webhook worker, the catalogue generator, and the portal config. The webhook worker's retry-classifier re-exports these constants so documentation and runtime cannot drift. SAMPLE_ENVELOPES in sample-payloads.ts are derived from the registry at module load time, ensuring sample payloads always match the current schema. The catalogue generator (docs/scripts/generate-webhook-catalogue.ts) renders index + per-event markdown pages from the registry and fails loudly on missing schemas. The redaction scanner (docs/scripts/redaction-scan.ts) scans built output against 6 deny-list patterns. Two complementary test suites gate the build: docs/test/portal-coverage.spec.ts (6 describe blocks, registry completeness + config parity via runtime constants + redaction + payload safety + front-matter) and test/docs/portal-coverage.spec.ts (7 describe blocks, includes cross-module parity check importing retry-classifier directly for structural verification).

## WO-047: User Story: WO-047 - SLA clock pause, resume and auditable state reconstruction
- **Status:** completed
- **Commit:** `a63c8e5`
- **Files:** 4 (+217/-6)
- **Duration:** 317ss
- **Approach:** N/A

## WO-048: User Story: WO-048 - Idempotent SLA reminder emission and on-call escalation routing
- **Status:** completed
- **Commit:** `baa8191`
- **Files:** 0 (+0/-0)
- **Duration:** 377ss
- **Approach:** All WO-048 source files were pre-committed on the branch. The implementation adds idempotent SLA reminder emission via a new sla_reminder_emissions table (migration 0039) with a UNIQUE INDEX on (timer_id, threshold_pct, channel) as the physical deduplication mechanism. The SlaReminderHandler processes sla.reminder_due and sla.breached events from a dedicated sla-notifications SQS queue (subscribed to the SNS topic with a filter policy) inside the existing notification worker deployable. The handler: (1) unwraps SNS envelopes and Zod-validates the event payload, (2) attempts INSERT INTO sla_reminder_emissions ON CONFLICT DO NOTHING RETURNING id — an empty result short-circuits as a no-op, (3) applies live-state guards re-reading timer.state/paused_at and ticket.status to suppress for cancelled/paused/terminal states, (4) resolves the recipient via a three-level fallback ladder (assignee email → assignment group member → SLA_ESCALATION_EMAIL env var → unroutable), (5) dispatches email via SesEmailSender (PII never logged) and outbound webhook with HMAC-SHA256 signing using signWebhookPayload(body, secret, timestampMs) over ${timestampMs}.${body}, with SSRF validation (HTTPS enforcement + IPv4/IPv6 CIDR deny-lists + DNS re-resolution). The Helm values.yaml declares the sla-notifications SQS queue with maxReceiveCount=5 redrive to a DLQ and two CloudWatch alarms (DLQ depth and sla_reminder_delivery_failed_total).

## WO-050: User Story: WO-050 - Live SLA countdown components with realtime deltas and polling fallback
- **Status:** completed
- **Commit:** `cf38d86`
- **Files:** 3 (+38/-8)
- **Duration:** 481ss
- **Approach:** N/A

## WO-055: User Story: WO-055 - Inbound Jira Sync Worker Applying Status and Comments
- **Status:** completed
- **Commit:** `5cc1afc`
- **Files:** 3 (+1722/-0)
- **Duration:** 785ss
- **Approach:** WO-055 delivers the inbound Jira sync worker pipeline. All core source files were already committed from blocker WOs (WO-054, WO-053): inbound.handler.ts (714-line pipeline with guarded claim, RLS binding, event classification, status translation, comment mirroring, loop prevention, link metadata update, Redis publish), event-classifier.ts (pure-function classifier with loop detection and stale-event guard), adf-converter.ts (ADF→plain-text converter with allow-list and truncation), worker.module.ts (InboundHandler registered with Pool+Redis injection), and migration 0032_jira_inbound_sync.sql (external_ref unique index, jira_updated_at, orphaned flag, integration_account_id). The implementation gap was the test surface (AC10–AC12): created event-classifier.spec.ts (22 unit tests for the pure classifier), inbound.handler.spec.ts (27 handler tests with FakePool/FakeRedis covering all AC paths), and test/fixtures/inbound-sync.fixtures.ts (8 envelope fixtures + factory helpers). All mock-based tests run without Postgres or Redis; DB-backed stubs in maybeDescribe document real-DB assertions for CI with DATABASE_URL.

## WO-056: User Story: WO-056 - Outbound Jira Sync Resilience: Retry, Rate Limit, DLQ
- **Status:** completed
- **Commit:** `1a0d8de`
- **Files:** 7 (+1321/-0)
- **Duration:** 713ss
- **Approach:** N/A

## WO-063: User Story: WO-063 - Per-tenant AI token budget and opt-out policy
- **Status:** completed
- **Commit:** `af49ced`
- **Files:** 3 (+1054/-0)
- **Duration:** 446ss
- **Approach:** All WO-063 source files were pre-committed from blocker WOs: tenant_ai_settings and tenant_ai_usage Drizzle schema (packages/db/src/schema/ai-policy.ts), migration 0042_tenant_ai_policy.sql (both tables with RLS enable/force + tenant_isolation policies + unique (tenant_id, period) index), AiPolicyService (getSettings/updateSettings with optimistic concurrency/getUsage), AiAdminController (GET+PUT /admin/ai/settings, GET /admin/ai/usage with ZodValidationPipe strict schemas), update-ai-settings.dto.ts (UpdateAiSettingsSchema z.strict(), AiUsageQuerySchema z.strict()), model-pricing.ts (MODEL_PRICE_TABLE with micros-per-1k-token to avoid float drift), DbAiPolicy (check() returning allow/disabled/budget_exhausted/policy_unavailable, recordUsage() atomic upsert with ON CONFLICT DO UPDATE, fire-once warning via warned_at column, emitUsageMetrics logging), AiPolicyPort with PermissiveAiPolicy default, and ai.module.ts wired into app.module.ts. Implementation gap was the test surface. Created: (1) db-ai-policy.spec.ts — 27 unit tests for the full policy decision matrix using FakePool/FakePoolClient; (2) ai-admin.spec.ts — 26 integration tests with mocked service via NestJS TestingModule + supertest; (3) ai-policy.fixtures.ts — three committed tenant profiles (healthy/exhausted/disabled) plus canned settings/usage rows and principal fixtures.

## WO-064: User Story: WO-064 - Synthesis retry cap, DLQ and operator alerting
- **Status:** completed
- **Commit:** `57c3e90`
- **Files:** 3 (+1009/-0)
- **Duration:** 545ss
- **Approach:** N/A

## WO-068: User Story: WO-068 - Dashboard Snapshot API with Postgres Fallback Path
- **Status:** completed
- **Commit:** `b739fb6`
- **Files:** 0 (+0/-0)
- **Duration:** 151ss
- **Approach:** N/A

## WO-057: User Story: WO-057 - Hourly Jira Link Reconciliation and Event Backfill
- **Status:** completed
- **Commit:** `3f0fcd9`
- **Files:** 9 (+1643/-0)
- **Duration:** 534ss
- **Approach:** N/A

## WO-059: User Story: WO-059 - Jira Integration Audit Trail and Sync Observability Instrumentation
- **Status:** completed
- **Commit:** `5ba6796`
- **Files:** 3 (+1167/-0)
- **Duration:** 656ss
- **Approach:** N/A

## WO-065: User Story: WO-065 - Agent-facing AI summary review, edit and regenerate
- **Status:** completed
- **Commit:** `2835a51`
- **Files:** 3 (+556/-0)
- **Duration:** 496ss
- **Approach:** N/A

## WO-069: User Story: WO-069 - Five-Second Delta Publisher and Sequenced Reconnect Backfill
- **Status:** completed
- **Commit:** `38975e2`
- **Files:** 3 (+1050/-0)
- **Duration:** 486ss
- **Approach:** All WO-069 source files (DeltaPublisherService, aggregate-diff.ts, publish-frame.lua, BackfillService, OutboundQueue, frame.types.ts) were pre-committed from blocker WOs, along with spec files for aggregate-diff and delta-publisher. The implementation gap was the missing unit and integration tests for BackfillService and OutboundQueue. Created three test files: (1) outbound-queue.spec.ts covering all queue operations, (2) backfill.spec.ts covering every handleSubscribe code path, and (3) backfill-reconnect.spec.ts providing mock-backed integration tests for the four reconnect scenarios plus replay idempotence.

## WO-098: User Story: WO-098 - Cross-Tenant Isolation and RBAC Negative Test Suite
- **Status:** completed
- **Commit:** `f8a37d0`
- **Files:** 10 (+2753/-0)
- **Duration:** 1031ss
- **Approach:** N/A

## WO-099: User Story: WO-099 - Generate OpenAPI 3.1 Specification From Code
- **Status:** completed
- **Commit:** `fbbed72`
- **Files:** 4 (+979/-0)
- **Duration:** 683ss
- **Approach:** N/A

## WO-070: User Story: WO-070 - Live Dashboard UI with Countdown Interpolation and Polling Fallback
- **Status:** completed
- **Commit:** `fbc5433`
- **Files:** 7 (+2125/-8)
- **Duration:** 651ss
- **Approach:** N/A
