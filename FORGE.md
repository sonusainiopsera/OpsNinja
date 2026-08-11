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
