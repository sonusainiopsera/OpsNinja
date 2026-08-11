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
