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
