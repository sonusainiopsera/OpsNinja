# Forge Implementation Log

| Field | Value |
|-------|-------|
| Project | bee1c2c9-e201-497f-818d-c58e46f7d8aa |
| Branch | forge/opsninja-d3d5df73-run11-88wo |
| Started | 2026-08-11T10:48:51Z |

---

## WO-004: User Story: WO-004 - Implement Tenant Context Interceptor and Transaction Scope
- **Status:** completed
- **Commit:** `a50eb26`
- **Files:** 5 (+91/-64)
- **Duration:** 1470ss
- **Approach:** Bootstrapped the NestJS API monorepo from an empty repo (npm workspaces, TypeScript 5 strict, ESLint boundary rules) and implemented the full WO-004 tenant-binding stack. UnitOfWork.withTenantTransaction() is the single database entry point: it opens a Drizzle transaction and issues one SELECT with six set_config(name, value, true) calls that bind app.current_tenant, app.current_user, app.principal_kind, app.current_org_ids plus per-request statement_timeout and idle_in_transaction_session_timeout in a single round trip. RequestContextStore wraps AsyncLocalStorage to expose typed getPrincipal()/getTx() getters that throw TENANT_CONTEXT_MISSING when called outside a bound context. TenantContextInterceptor is registered globally after AuthGuard, consults Reflector for @NoTenantContext exemptions, rejects unauthenticated requests with 401 and tenant-less principals with 500, races handler completion against a client-disconnect signal to guarantee rollback, and delegates all database setup to withTenantTransaction. TenantRepository provides the abstract base class. A second commit fixed TypeScript strict-mode issues: definite-assignment assertion on disconnectReject, removed unused Reflector import in main.ts, rewrote the interceptor spec mock to wrap fn() inside RequestContextStore.run() (the original mock called fn() outside any active context, causing _set() to throw in every authenticated test), and fixed a syntax error in an e2e test string literal.

## WO-011: User Story: WO-011 - Access token issuance and rotating refresh session store
- **Status:** completed
- **Commit:** `29662ff`
- **Files:** 5 (+47/-59)
- **Duration:** 1972ss
- **Approach:** Separated stateless token minting (TokenService) from stateful session storage (SessionService). TokenService signs RS256 JWTs with all 10 required claims (sub, tenant_id, roles, org_scope_version, user_type, jti, iat, exp, iss, aud), 15-minute TTL, kid in the JWT header, and key rotation via JWT_PREV_PUBLIC_KEY fallback. SessionService generates 256-bit CSPRNG refresh tokens, stores only the SHA-256 hash plus userId/principalKind/roles snapshot in a Redis hash under session:{tenantId}:{sessionId} with an 8-hour TTL. Atomic rotation uses a Lua compare-and-swap script (SCRIPT LOAD / EVALSHA with NOSCRIPT retry); the previous hash is preserved for a 30-second grace window for concurrent browser-tab refresh. Replay outside the grace window triggers family-wide revocation via session_family:{tenantId}:{familyId} Redis sets. rotateSession() returns the stored principal alongside the new token so the auth controller can re-mint without requiring an access token or test header. AuthController wires POST /auth/refresh (rotate + re-mint, principal from Redis) and POST /auth/logout (revoke + cookie cleared) as @NoTenantContext routes with exact cookie attributes. All audit events exclude token values and hashes.

## WO-012: User Story: WO-012 - RBAC route guard and principal context propagation
- **Status:** completed
- **Commit:** `6d2ce81`
- **Files:** 19 (+1803/-38)
- **Duration:** 1255ss
- **Approach:** Replaced the WO-004 stub AuthGuard with a production implementation that: (1) verifies RS256 JWTs against multiple valid audiences (staff/portal/machine), distinguishing AUTH_TOKEN_MISSING, AUTH_TOKEN_EXPIRED, AUTH_TOKEN_INVALID; (2) reads @RequirePermission() metadata via Reflector and denies-by-default when no declaration exists; (3) enforces audience tiers so portal tokens cannot satisfy staff permissions and vice versa, returning AUTHZ_AUDIENCE_MISMATCH; (4) resolves effective permissions via PermissionResolverService which caches under rbac:{tenantId}:{roleSetHash} in Redis with 60s TTL and falls back to a hardcoded role-permission map on Redis outage; (5) writes an immutable audit_logs record for every 401/403 via AuditService (global module); (6) tracks denial rate per principal and emits an operator alert on >20 denials in 5 minutes. PrincipalContext interface extended with permissions and orgScopeVersion; a request-scoped PRINCIPAL_CONTEXT_TOKEN provider allows services to inject the principal without touching HTTP objects. TokenService extended with isTokenExpired() helper and multi-audience verifyAccessToken option.

## WO-015: User Story: WO-015 - Portal user visibility hardening and internal note protection
- **Status:** completed
- **Commit:** `30b7408`
- **Files:** 25 (+1662/-3)
- **Duration:** 1269ss
- **Approach:** Implemented portal visibility hardening via three interlocking layers: (1) AuthGuard audience enforcement (portal:* permissions require portal-audience token), (2) PortalVisibilityGuard validates principalKind=portal and orgScopeIds≥1 on every portal controller route, (3) repository-layer scoped-query predicates (portalTicketFilter applies org binding, portalCommentFilter applies visibility=public) with no bypass parameter. Portal responses are serialised only through explicit DTO mapper functions that structurally omit internal fields. AttachmentAccessService resolves the full attachment→comment→ticket chain and fails closed. TenantSettingsService gates AI summary exposure defaulting to disabled. Architecture tests scan source for entity spreads and portal DTO boundary violations.

## WO-019: User Story: WO-019 - Deliver OpsNinja Domain Primitives and DataTable
- **Status:** completed
- **Commit:** `29a7b9e`
- **Files:** 34 (+2620/-0)
- **Duration:** 938ss
- **Approach:** Created @opsninja/ui-kit from scratch as a React 19 + TypeScript strict package. Implemented the functional-core / imperative-shell pattern: computeRemaining is a pure clock-injected function with no side effects; SlaClockProvider owns the single shared 1s setInterval and aria-live region; all SlaCountdown instances subscribe via React context. Monotonic offset (performance.now captured on each server delta) corrects browser clock skew without trusting Date.now. SlaHint is a deliberately isolated file with no SlaCountdown import, enforced by a source-scan test. DataTable is a controlled headless grid with useGridKeyboardNavigation providing the full ARIA grid keyboard pattern as a separate hook.

## WO-020: User Story: WO-020 - Implement Agent Workspace Application Shell
- **Status:** completed
- **Commit:** `01ddfab`
- **Files:** 32 (+2649/-4)
- **Duration:** 755ss
- **Approach:** Built the Next.js 15 App Router AppShell for all authenticated agent routes. Navigation uses a pure declarative config (navConfig.ts) filtered by a side-effect-free RBAC helper (canFor.ts) that excludes unauthorized items from the DOM entirely. The Sidebar manages SSR-safe localStorage collapse persistence and an off-canvas mobile drawer with focus trap. Identity and org scope come from TanStack Query hooks (staleTime=30s) that degrade gracefully to skeletons then inline errors. LiveStatusPill reads a Zustand store with 2s debounce; the shell never opens the WebSocket. ExportMenu dispatches to a page-registered handler via React context. ShellErrorBoundary is a class component that surfaces traceId while suppressing stack traces.

## WO-022: User Story: WO-022 - Build Isolated Customer Portal Shell Bundle
- **Status:** completed
- **Commit:** `1787715`
- **Files:** 31 (+2109/-0)
- **Duration:** 882ss
- **Approach:** Built the customer portal application shell as a structurally distinct layout from the agent workspace. The shell is composed exclusively from the portal-safe @opsninja/ui-kit/portal entry point. Bundle isolation is enforced at two layers: an ESLint no-restricted-imports rule blocks the ui-kit root barrel and all agent-only paths at write time, and scripts/assert-bundle-isolation.ts scans production .next/ chunks for a deny-list of agent-only module identifiers at build time. PortalShell uses TanStack Query to fetch portal identity (401 not retried), renders skeletons while loading and a recoverable inline error on failure. PortalTabs derives active state purely from usePathname (URL-driven, not client state). CsatBanner uses a SSR-safe localStorage hook keyed by survey ID so dismissal persists per survey without hydration mismatch. PortalHeader shows org logo with accessible initials fallback, read-only OrgScopePill, HelpLink, theme toggle, and PortalUserMenu — no TenantSwitcher, GlobalSearch, LiveStatusPill, or ExportMenu anywhere in the portal.

## WO-038: User Story: WO-038 - Allow-Listed Saved View Filter AST Compiler
- **Status:** completed
- **Commit:** `288084a`
- **Files:** 23 (+2341/-1)
- **Duration:** 645ss
- **Approach:** Built @opsninja/filter-compiler as a zero-framework, zero-DB shared package with strict TypeScript (no any). The package exposes four functions: parseFilterAst (Zod .strict() structural parse), validateFilterAst (field allow-list + operator allow-list + value schema semantics, typed errors per path), compileToPredicate (pure function producing parameterized SQL with $N positional placeholders — user literals appear only in params, never in the sql string), and computeSignature (canonical JSON sorted-key SHA-256 prefixed with compiler version). The field registry maps 14 allow-listed fields declaratively: tag_id and affected_area use EXISTS subqueries to prevent row multiplication. A Clock interface makes relative date tokens (9 tokens: today, yesterday, last_7_days, etc.) deterministic in tests. Both SavedViewService and ReportFilterService consume the same compiled package — no duplicate filter SQL logic. An architecture test source-scans both modules to assert this invariant.

## WO-072: User Story: WO-072 - Reporting Read-Replica Data Source With Guardrails
- **Status:** completed
- **Commit:** `458a849`
- **Files:** 16 (+1096/-3)
- **Duration:** 915ss
- **Approach:** Created a fully isolated reporting read-replica data path as a NestJS module (ReportingReadReplicaModule) backed by a dedicated pg Pool (max 8, connectionTimeoutMillis 5000). The REPORTING_DB DI token exposes a Drizzle DB instance that is entirely distinct from the primary DB_TOKEN so no reporting query path can accidentally obtain the primary client via DI. ReportingDbClient wraps the Pool, attaches the on-connect hook for session-level statement_timeout (30s), idle_in_transaction_session_timeout (60s), and default_transaction_read_only. TenantScopedReplicaRunner opens a Drizzle transaction, issues SET LOCAL app.current_tenant via set_config(name, value, true) before any application query, and throws ReplicaTenantContextMissingError when no principal is in context. RowLimitGuard passes ROW_CAP_LIMIT (500001) as the LIMIT to the query builder (server-side enforcement), then checks client-side for overflow and raises RowLimitExceededError with code REPORT_ROW_LIMIT_EXCEEDED. ReplicaLagProbe polls pg_last_xact_replay_timestamp() every 15s on a dedicated max-1 pool, returning lag=0/isStandalone=true for single-node dev. Health endpoint /health/reporting-replica uses the cached freshness, returns 503 with a structured body (no credentials) when lag exceeds threshold or probe hasn't sampled yet.

## WO-080: User Story: WO-080 - Notification Engine Schema and SES Email Delivery Worker
- **Status:** completed
- **Commit:** `72cbbf3`
- **Files:** 31 (+2179/-0)
- **Duration:** 642ss
- **Approach:** Built the notification substrate as a ports-and-adapters worker on top of the existing NestJS/Drizzle/PgBouncer stack. Schema: three Drizzle tables (notification_templates, notifications partitioned monthly, notification_suppressions) with RLS FORCE ROW LEVEL SECURITY policies and a unique (tenant_id, dedupe_key) index for idempotency. Migration SQL creates the partitioned table, pre-creates 4 monthly partitions, and sets NOSUPERUSER NOBYPASSRLS. The worker is a standalone NestJS context that polls SQS (batch 10, waitTimeSeconds 20) and processes each message in a Drizzle transaction with SET LOCAL app.current_tenant. Idempotency: ON CONFLICT DO NOTHING on insert aborts duplicate envelopes before any send. Suppression: SHA-256 email hash lookup against notification_suppressions before calling EmailSenderPort. Rate limiting: Lua token-bucket script in Redis (20/s default). SES errors classified into RETRYABLE (re-queue) vs TERMINAL (mark failed, ACK). Log redactor in @opsninja/observability strips email addresses and named PII fields from all log records. DLQ routing enforced by SQS max-receive-count=5 via Helm values. EmailSenderPort interface with SesEmailSender (IRSA) and InMemoryEmailSender (tests). Admin endpoint GET /api/v1/admin/notification-templates behind Admin role.

## WO-083: User Story: WO-083 - Tenant Webhook Subscription Management with SSRF Guard
- **Status:** completed
- **Commit:** `a14f362`
- **Files:** 26 (+2294/-0)
- **Duration:** 849ss
- **Approach:** Implemented the full WO-083 webhook management plane with three layers of SSRF protection: (1) URL structure validation (scheme, credentials, port), (2) DNS-resolved IP CIDR deny-list, (3) per-delivery re-validation in test-fire. Envelope encryption via a new @opsninja/crypto package (KmsEnvelopeCipher with tenant_id encryption context + InMemoryEnvelopeCipher test double). Signing secrets are CSPRNG-generated, encrypted at rest, returned as plaintext only in the 201-create and 200-rotate responses, and never present in any summary/list path. Rotation keeps the previous secret valid for a configurable grace period (24h default). Every mutation writes an immutable audit record within the same tenant-scoped transaction so no endpoint change can exist without an audit row. 404 (not 403) is returned for cross-tenant endpoint IDs to avoid existence disclosure. WEBHOOKS_MANAGE permission added to the catalogue and mapped to integration_admin and admin roles.

## WO-093: User Story: WO-093 - Cross-Cutting Audit Capture for All Mutations
- **Status:** completed
- **Commit:** `06a65e7`
- **Files:** 22 (+1552/-13)
- **Duration:** 938ss
- **Approach:** Implemented a cross-cutting audit capture layer using AsyncLocalStorage for context propagation. AuditContext seeds actor/tenant/trace metadata from HTTP interceptors (AuditInterceptor, registered as 2nd global APP_INTERCEPTOR inside TenantContextInterceptor) and from withAuditContext() wrappers for SQS workers. AuditWriter.append() uses the ambient transaction handle from RequestContextStore.getTx() ensuring audit records are transactionally coupled to mutations — failure re-throws, rolling back the mutation. Sensitive data is redacted through a DefaultRedactor injected as REDACTION_PORT. The @Auditable decorator registers method metadata in AuditCoverageRegistry at bootstrap; a CI guard test (audit-coverage.spec.ts) enumerates required methods and fails if any lack @Auditable decoration.

## WO-097: User Story: WO-097 - Anonymised Multi-Tenant Seed and Fixture Generator
- **Status:** completed
- **Commit:** `ca4b5da`
- **Files:** 26 (+2191/-0)
- **Duration:** 661ss
- **Approach:** Created a standalone @opsninja/test-seed workspace package with a functional-core / imperative-shell architecture. Pure factory modules (no DB) build typed objects conforming to Drizzle schema inferred types; a SeededPrng (Mulberry32) is injected through every factory constructor and Math.random() is banned via ESLint no-restricted-syntax. The persistence shell (SeedRunner) orchestrates factory calls, streams inserts in 500-row batches, pre-creates monthly partitions via PartitionProvisioner SQL, and enforces a test-host guard. AnonymisationValidator scans every generated value with regex deny-lists. The collision matrix config explicitly names which natural keys (email local-parts, ticket subjects, Jira issue keys) are shared across tenant pairs so isolation tests can assert on them.

## WO-006: User Story: WO-006 - Enforce RBAC Permissions and Agent Organization Scoping
- **Status:** completed
- **Commit:** `195308d`
- **Files:** 18 (+1308/-10)
- **Duration:** 767ss
- **Approach:** Implemented three enforcement layers: (1) a frozen permission matrix with ROLE_PERMISSION_MAP covering all 10 role types and a TENANT_WIDE_ROLES set, wired into AuthGuard via PermissionResolverService; (2) an org-scope resolver (OrgScopeService) with Redis version-keyed cache (60s TTL), atomic INCR counter, DB fallback on cache miss/Redis failure, and cold-start seeding at v0 to prevent false STALE rejections; (3) a parameterised Drizzle scope predicate with explicit handling for empty sets (1=0 sentinel), portal principals (single-org eq), tenant-wide roles (undefined/no filter), and large sets >50 orgs (EXISTS subquery). AuthGuard checks scope version staleness before building PrincipalContext, rejecting stale tokens with 401 SCOPE_VERSION_STALE. The GET/PUT /api/v1/organizations/agent-scopes/:userId endpoints require ORGS_MANAGE_SCOPES, validate every org ID belongs to the caller's tenant, replace the scope set atomically, bump the Redis counter, and write before/after audit records. 404 masking via assertFound() ensures out-of-scope and non-existent resources produce identical 404 responses.

## WO-008: User Story: WO-008 - Automate Cross-Tenant Isolation Test Harness and Fixtures
- **Status:** completed
- **Commit:** `66e13d2`
- **Files:** 14 (+1647/-4)
- **Duration:** 573ss
- **Approach:** Built the isolation harness in four layers: (1) a deterministic two-tenant in-memory fixture factory (tenant-factory.ts) with deliberately colliding org names and hardcoded UUIDs derived from readable seeds; (2) a principal token helper (principals.ts) minting valid JWTs for all roles in both tenants using the shared test keypair from rbac.fixtures.ts; (3) two offline e2e suites (isolation-contract, portal-isolation) that run with fake Redis/DB using the existing mock pattern from rbac.e2e-spec.ts, asserting cross-tenant 404 masking, org-scope enforcement, portal audience mismatch, and sibling-org invisibility; (4) two DB-backed suites (isolation-metadata, negative-privileges) that skip automatically when no test DB is available and assert RLS policy completeness and runtime role privilege denial. A global setup helper, a dedicated jest config, package.json test:isolation scripts, and a runbook complete the CI wiring.

## WO-013: User Story: WO-013 - Agent organization scope enforcement and scope-change reauthorization
- **Status:** completed
- **Commit:** `44389b7`
- **Files:** 9 (+889/-2)
- **Duration:** 855ss
- **Approach:** Built on the WO-006 foundation (OrgScopeService, agentOrgScopes table, scope predicate). Added the WO-013 API contract: (1) AUTH_REAUTHORIZE_REQUIRED error code (details:[{reason:'scope_changed'}]) replacing SCOPE_VERSION_STALE in the staleness check; (2) agentOrgScopeFilter() helper in scoped-query.helper.ts as the single repository integration point; (3) GET/PUT /api/v1/users/:userId/org-scope endpoints in users.controller.ts returning tenantWide flag, added/removed diff, and scopeVersion; (4) architecture test scanning repository files for unguarded scoped-table access; (5) org-scope fixture matrix with two partially-overlapping agents across three orgs; (6) unit tests covering all new behaviors.

## WO-016: User Story: WO-016 - Authentication abuse throttling and security audit telemetry
- **Status:** completed
- **Commit:** `134e179`
- **Files:** 14 (+1204/-9)
- **Duration:** 604ss
- **Approach:** Implemented application-level authentication throttling and security telemetry in three layers: (1) ThrottleService with Redis INCR sliding-window counters keyed by SHA-256(type:subject) — no PII at rest — plus a separate lockout key with exact TTL; configurable via THROTTLE_* env vars with defaults of 5 failures/hour and 15-min lockout; fail-closed on Redis unavailability (503 not fail-open); (2) ThrottleGuard with @ThrottleByEmail()/@ThrottleByIp() decorators applied to auth routes, Retry-After computed from actual lockout TTL, uniform 429 body for existing and non-existing accounts; (3) AuthAuditEmitter as a single funnel for all identity security events, POST /api/v1/admin/auth/unlock endpoint requiring ADMIN_AUTH_UNLOCK permission; extended PII redactor in @opsninja/observability with phone number (E.164/national), IPv4/IPv6, and free-text field patterns.

## WO-021: User Story: WO-021 - Build Typed API Client With Silent Token Refresh
- **Status:** completed
- **Commit:** `76aab0a`
- **Files:** 26 (+2017/-0)
- **Duration:** 849ss
- **Approach:** Built a shared @opsninja/api-client workspace package (sibling to @opsninja/ui-kit) with three architectural layers: (1) transport core — typed fetch wrapper with credentials:include, configurable base URL, X-Correlation-Id header, AbortController timeout, and parseErrorEnvelope that handles valid JSON envelopes, HTML error pages, empty bodies and malformed JSON without throwing parse exceptions; (2) session layer — SessionManager with a single shared refreshPromise for single-flight behaviour, classify401 disambiguation that maps AUTH_TOKEN_EXPIRED to refresh-and-replay, AUTH_REAUTHORIZE_REQUIRED/SCOPE_VERSION_STALE to force re-auth (zero retries), and unknown 401 codes to fail-closed re-auth; loop guard on the isReplay flag prevents recursive refresh; (3) TanStack Query integration — createOpsninjaQueryClient with taxonomy retry rules and queryKeys factory embedding tenantId + orgScopeVersion. Retry logic with jittered exponential backoff honours Retry-After (delta-seconds + HTTP-date) for idempotent requests only. Server entry point requires explicit cookieHeader and throws SERVER_CLIENT_MISCONFIGURED if absent. Both web apps wired with thin SessionManager + QueryClient factories.

## WO-023: User Story: WO-023 - Organization registry schema with tenant-scoped RLS policies
- **Status:** completed
- **Commit:** `715cbf7`
- **Files:** 11 (+1141/-10)
- **Duration:** 607ss
- **Approach:** Expanded the existing organizations table and created four new tenant-scoped registry tables in packages/db. Drizzle schema files define TypeScript types; the SQL migration (005) is handwritten for full control over RLS policy wording, index expressions, and enum idempotency. All five tables carry ENABLE + FORCE ROW LEVEL SECURITY with a FOR ALL policy using both USING and WITH CHECK, so both read and write paths enforce tenant isolation. Composite PKs (tenant_id, id) on new tables and a unique constraint (tenant_id, id) added to organizations allow composite FK references that make cross-tenant joins structurally invalid at the constraint level. citext extension used for email and domain fields. Expand-only column additions (ADD COLUMN IF NOT EXISTS) and DO$$-guarded enum creation make the migration re-runnable. Down migration reverses all changes child-first to respect FK order.

## WO-039: User Story: WO-039 - System And Custom Saved Views API With Pinning
- **Status:** completed
- **Commit:** `25c2225`
- **Files:** 14 (+1434/-2)
- **Duration:** 734ss
- **Approach:** Implemented the full views module: Drizzle schema + SQL migration 006 with RLS for saved_views and saved_view_pins tables; idempotent system-view seeder for four built-in views with placeholder tokens (CURRENT_USER, CURRENT_ORG_SCOPE); ViewsRepository extending TenantRepository with all CRUD + pin operations; ViewsService using RequestContextStore.getPrincipal() for principal access, write-time AST validation via SavedViewService, placeholder substitution at read time, ownership/RBAC enforcement, 409 name-conflict detection, audit records storing AST signatures; ViewsController with Zod inline parse pattern matching existing codebase conventions; VIEWS_SHARE permission added to permissions.ts and granted to admin/supervisor/manager roles.

## WO-044: User Story: WO-044 - SLA policy and business calendar schema with tenant-scoped CRUD API
- **Status:** completed
- **Commit:** `ac55cf1`
- **Files:** 18 (+2008/-0)
- **Duration:** 509ss
- **Approach:** Implemented the SLA module as a new NestJS module following existing codebase patterns. Created Drizzle schema for all 5 tables (sla_calendars, sla_calendar_windows, sla_calendar_holidays, sla_policies, sla_policy_versions) with expand-only migration 007 containing ENABLE/FORCE RLS and per-tenant USING+WITH CHECK policies. Used pgEnum for sla_priority, sla_calendar_type, sla_scope_type. Unique partial index on (tenant_id, scope_type, COALESCE(scope_id, nil_uuid), priority) WHERE is_active plus check constraints enforce business rules at the DB level. Append-only trigger on sla_policy_versions prevents UPDATE/DELETE. Zod strict-mode DTOs validate timezone (Intl.supportedValuesOf), reminder ordering, target minute bounds, and business_hours calendar must have windows. Services use RequestContextStore.getPrincipal() pattern, write version snapshots and audit records in the same tenant transaction. Controllers use inline parseBody() pattern matching existing codebase conventions. Added SLA_POLICY_READ/WRITE permissions to admin/supervisor/manager; agent role gets read-only.

## WO-051: User Story: WO-051 - Per-Tenant Jira Connection and Credential Vault
- **Status:** completed
- **Commit:** `3431388`
- **Files:** 18 (+1996/-0)
- **Duration:** 782ss
- **Approach:** Implemented the Jira connection domain aggregate following existing NestJS/Drizzle/RLS patterns. DB schema uses pgEnum for auth_method/state with three indexes: tenant_id-leading, per-tenant unique (tenant_id, cloud_id), and global unique cloud_id to block cross-tenant binding. Migration 008 is expand-only with ENABLE/FORCE RLS and ALL-command permissive policy. CredentialVaultService wraps KmsEnvelopeCipher from @opsninja/crypto with AWS Secrets Manager: stores opaque secret_ref in DB and envelope-encrypted ciphertext in Secrets Manager. JiraOAuthService generates PKCE S256 authorization URLs with Redis-backed single-use 10-minute state TTL (getdel ensures single-use). JiraTokenProvider caches access tokens in Redis with TTL=expires_in-60s skew and uses SET NX for single-flight refresh lock to prevent stampede. Cross-tenant bind rejected at INSERT level by global unique constraint (RLS hides other tenants' rows so pre-flight check only works for same-tenant; cross-tenant caught by DB constraint). Log-redactor extended with all credential field names. JIRA_MANAGE permission added to admin and integration_admin roles.

## WO-066: User Story: WO-066 - Realtime Gateway WebSocket Service with Tenant Channel Auth
- **Status:** completed
- **Commit:** `52f29ac`
- **Files:** 21 (+2070/-0)
- **Duration:** 522ss
- **Approach:** Scaffolded a new NestJS application at apps/realtime-gateway, sharing observability library but importing no Postgres/ticket/SLA modules. Core components: (1) WsAdapter — custom ws library adapter that intercepts HTTP upgrades, routes only /ws/v1/dashboard, enforces 64KB max payload. (2) JwtVerifier — RS256 JWT verification via JWT_PUBLIC_KEY env var (no JWKS call, no Postgres). (3) ConnectionRegistry — in-memory Map<tenantId, Map<socketId, SocketWrapper>> with per-principal tracking for tab-count cap. (4) DashboardGateway — handshake authenticator enforcing pod+principal caps, token verify (4401 on failure), channel auth (4403), scope-version check at connect (4440), hello frame on connect, going_away+startDrain on SIGTERM. (5) HeartbeatService — two intervals: ping+reaper (configurable, default 30s interval + 10s pong deadline) and scope-version revalidation (default 60s, compares Redis counter against token claim, closes 4440 on mismatch). (6) PubSubSubscriber — dedicated Redis client subscribed to dash:* pattern, exponential backoff reconnect, dispatches to matching tenant sockets with org-scope filtering. (7) OrgScopeFilter — pure function stripping orgBreakdown entries outside the socket's orgScopeIds set; tenant-wide roles receive full frame unmodified. (8) HealthController — /healthz (liveness) and /readyz (checks PubSubSubscriber.isReady() for Redis state, returns 503 if not ready).
