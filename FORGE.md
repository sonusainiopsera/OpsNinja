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
