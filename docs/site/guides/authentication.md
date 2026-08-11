---
title: "Authentication and Token Lifecycle"
audience: "integration-developer"
last-reviewed: "2026-08-11"
---

# Authentication and Token Lifecycle

OpsNinja uses short-lived RS256 JWTs for API access, paired with rotating opaque refresh tokens
stored in `httpOnly` cookies. Machine-to-machine integrations use the same JWT format with a
`user_type: machine` claim.

## Obtaining a Token

### Staff and Integration Admin (OIDC)

Staff users authenticate via your organisation's identity provider (Okta or Entra ID) using
Authorization Code + PKCE:

1. Redirect the user to your IdP's authorisation endpoint.
2. Exchange the authorisation code at `POST /api/v1/auth/callback`.
3. The response sets a `httpOnly; Secure; SameSite=Strict` refresh cookie valid for **8 hours**.
4. The JSON body contains a short-lived access token (15-minute TTL).

### Machine Principals

Machine tokens are provisioned by a Support Administrator via the Admin Console. They carry
`user_type: machine` and satisfy only `machine:*` permissions — they cannot call staff-only
endpoints.

## Access Token Structure

```
Header:  { "alg": "RS256", "kid": "<key-id>" }
Payload: {
  "sub":               "<user-id>",
  "tenant_id":         "<tenant-id>",
  "user_type":         "portal|staff|machine",
  "roles":             ["agent", ...],
  "org_scope_version": 42,
  "aud":               "opsninja-api",
  "iat":               1700000000,
  "exp":               1700000900
}
```

The public JWKS endpoint for signature verification is:

```
GET /api/v1/.well-known/jwks.json
```

No authentication is required to fetch the JWKS. Rotate your cached JWKS on a `kid` cache miss,
not on a timer.

## Token Refresh

When the access token expires (HTTP 401 `AUTH_TOKEN_EXPIRED`), send the refresh cookie to:

```
POST /api/v1/auth/refresh
```

The response issues a new access token and rotates the refresh cookie. The previous refresh token
is immediately invalidated. Concurrent refresh requests from multiple browser tabs are handled
with a 30-second grace window: the first request rotates the token; subsequent requests within
the grace window receive the same new token.

If you detect reuse outside the grace window (`AUTH_REFRESH_REUSE_DETECTED`), all sessions for
the user are revoked and a security alert is raised. Treat this as a sign of token theft.

## Tenant Scoping

Every token is bound to exactly one `tenant_id`. All API requests execute within that tenant's
Row-Level Security context. There is no cross-tenant API surface.

Portal users are additionally bound to a single `organization_id` (the `bound_org_id` JWT claim).
They can only see tickets belonging to their organisation.

## Org Scope Version

The `org_scope_version` claim is compared against a server-side counter on every request. If an
administrator narrows an agent's organisation scope, the counter increments and the next API
call from that agent receives:

```json
{ "error": { "code": "AUTH_REAUTHORIZE_REQUIRED", "details": [{ "reason": "scope_changed" }] } }
```

The client must re-authenticate to obtain a token reflecting the new scope.

## Token Rotation and Secret Management

- Access token signing keys are rotated without downtime using `kid`-based JWKS discovery.
- Webhook signing secrets support a grace rotation window: during rotation, both the current and
  previous secrets are accepted (see [Webhooks: Signature Verification](../webhooks/index.md)).
- API keys (machine principals) can be revoked instantly via the Admin Console or
  `DELETE /api/v1/admin/machine-tokens/:id`.

## Logout

```
POST /api/v1/auth/logout
```

Invalidates the refresh token immediately server-side and clears the cookie. Subsequent refresh
attempts with the old cookie receive `AUTH_SESSION_NOT_FOUND`.

## Rate Limits on Auth Endpoints

Authentication endpoints have stricter rate limits than the general API. See
[Pagination and Rate Limits](./pagination-and-rate-limits.md) for threshold details and
`Retry-After` handling.
