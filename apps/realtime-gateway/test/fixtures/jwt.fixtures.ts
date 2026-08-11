/**
 * JWT fixtures for Realtime Gateway tests.
 *
 * Uses an inline RSA test key pair so tests run without external key material.
 * These keys are TEST-ONLY and must never be used in production.
 *
 * Exports:
 * - TEST_RSA_PUBLIC_KEY / TEST_RSA_PRIVATE_KEY  — 2048-bit RSA test keys
 * - mintTestToken(claims)                        — mint a signed RS256 JWT
 * - FIXTURE_TOKEN_AGENT_A                        — scoped agent (tenant A)
 * - FIXTURE_TOKEN_MANAGER_B                      — unscoped manager (tenant B)
 * - FIXTURE_TOKEN_OUT_OF_SCOPE                   — agent with empty scope set
 * - FIXTURE_TOKEN_EXPIRED                        — already-expired token
 */

import * as jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Test RSA key pair (2048-bit, TEST-ONLY — never use in production)
// ---------------------------------------------------------------------------

export const TEST_RSA_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4JBXj2RiSauJHyp8JaLbOOkXnFU
6rQUGS4L4E+1JwFmRLEU9E8KgKiHTkJyBbhJUFvBILBaSfBwSheaKbQ6yRmcU7/O
hFfI1y+GBv9KPbsWHBrMZXnJU6Xj3l/vfGijbAchOPdFNNrjzP1t7SxVU9j8Z6r3
2Q+NiOmkKfIqEBZPJQiDBP7HQWW5uqSVmCVqXXFGHwPE9Q3I5nENLqKTGvGJoGz
ZHCQMgGJ5xVFdRGbKfT5HNbhvRKdz/m3MUjFwVifBgiBERcqrQxHGSmAbO/KiHv1
3YKTS0LKvF7GYCQkl3T8lG4kIh5ZGC4kBwIDAQABAoIBAC5RgZ+hBx7xHNaMpPgw
KflUfCCmFYaLsxRQwcFmrI8fVpVdpFw2p6bQniNYHGZFpULRXYgHs2yARdT3q4b5
FIAMvmLmApRhJmRqMYjFqPB1gVxoIVhiCHgGVyIL8dAQCHmkLRoKbfFJc5vRVMFX
MYUMbfGa2b8+Fd2uA3JFyJBxl0oCWFGPmJmqEU0lzZW7HixlqsFLt1sxiCNKV0oR
kMM9LPbopZCJ0oKsN3lWv1m+jhlVW2Bx1GBqt9R1vCHG8LYoQD7vPMvnMLBBf7jX
dkNIFqmkSdnxAQZ3P4fDRdDf7q5y7i1x0W1T2M8bk0ZiMqwVVMWB/mC3GMDRT0EC
gYEA7N5p5BAMeGm4F8kDjMZWWZNHoCOFhTb8FaXPtxDH3kFGmNMPJMIZ6kOHdPiE
UGFrNvX4cKjx3uoE+2zLj5PFwjIY1EfGbRFSJdT5cFChFrUbISk/e1y4nDVvHcMJ
Z0tGmb8fhBqBhS4K2p3V8e7rh1lEj3d3zxWkLKbQ5V8CVgECgYEA4v3RCiLi+f8h
2V7lKl/pxpb4lYeT8jW8rQbxMiJgJ0N3v1S0oQ1LL9Z7I3EbqjJxpU5LF3lCpBBL
T8m9E0+MVCUwWXFHlGvCGZ0oMlxmN5EVoX+jBjlSDqU4MpSa9kpXSmT0VrFqIFmA
v9UFE2mF5oamz2SFIS4xYEjaSncCgYBQBKQxf2Tq9S4k3Q0wVlJXl4sA+pB4a2Gy
F3J4rItcUMwU/YuO5dkXHDx98R8O4MLqU3y2h+IsTbqjK/pKdE0aL7UMm0ww0t8i
dCiO6EVuEzH5dSoqAmn4p3I5MFfFkqsXzZGkmJnb+FH+wWHI9k8IlVQJxf6Sf1Qv
4FMgAQKBgQCp6p97ePBqR2EXL+m5n8CnEYSidIhYFdXP5W7eBD3zFt+JvA0D1rBn
5i5WQ+wH1m3lWf0/JRD8nFyYX2yH7FVFh6H3x5A/aNWOAYtL0t7Af2TeBF7I+2/X
QZ5vGLVuEPFnLnMCTFEGRZ2vWn/T5X5kFMJg9+T9MKBO4aX5gQKBgQCNqRyGkRoH
dlBU3/JhH+GOCF5ydRZzJ9E4T+SiSVrKdS7BKIL7j4iWEYJOFhZU7/F5M0YOAEO
xG+m3S/CkTsMR1o5DP3xJI2RfQWFBIYMxWsXZNxTUV3e4sDoGMcf4BKC3xz0nwfH
b1lm7RWXj2gN1Reo1K+g4PjpN7x+xQ==
-----END RSA PRIVATE KEY-----`;

export const TEST_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xHn/ygWe
p4JBXj2RiSauJHyp8JaLbOOkXnFU6rQUGS4L4E+1JwFmRLEU9E8KgKiHTkJyBbhJ
UFvBILBaSfBwSheaKbQ6yRmcU7/OhFfI1y+GBv9KPbsWHBrMZXnJU6Xj3l/vfGij
bAchOPdFNNrjzP1t7SxVU9j8Z6r32Q+NiOmkKfIqEBZPJQiDBP7HQWW5uqSVmCVq
XXFGHwPE9Q3I5nENLqKTGvGJoGzZHCQMgGJ5xVFdRGbKfT5HNbhvRKdz/m3MUjFw
VifBgiBERcqrQxHGSmAbO/KiHv13YKTS0LKvF7GYCQkl3T8lG4kIh5ZGC4kBwIDAQAB
-----END PUBLIC KEY-----`;

// ---------------------------------------------------------------------------
// Deterministic test UUIDs
// ---------------------------------------------------------------------------

export const TENANT_A_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
export const TENANT_B_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
export const AGENT_A_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
export const MANAGER_B_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
export const ORG_1_ID = 'cccccccc-0000-0000-0000-000000000001';
export const ORG_2_ID = 'cccccccc-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

export interface TestTokenClaims {
  sub: string;
  tenant_id: string;
  roles: string[];
  org_scope_version: number;
  user_type: 'staff' | 'portal' | 'machine';
  expiresIn?: number;
}

export function mintTestToken(claims: TestTokenClaims): string {
  const { expiresIn = 900, ...rest } = claims;
  return jwt.sign(rest, TEST_RSA_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn,
    issuer: 'https://api.opsninja.io',
    audience: 'opsninja',
  });
}

// ---------------------------------------------------------------------------
// Named fixture tokens
// ---------------------------------------------------------------------------

/** Scoped agent for tenant A — can only see ORG_1_ID. */
export const FIXTURE_TOKEN_AGENT_A = mintTestToken({
  sub: AGENT_A_ID,
  tenant_id: TENANT_A_ID,
  roles: ['agent'],
  org_scope_version: 1,
  user_type: 'staff',
});

/** Unscoped manager for tenant B — can see all orgs in tenant. */
export const FIXTURE_TOKEN_MANAGER_B = mintTestToken({
  sub: MANAGER_B_ID,
  tenant_id: TENANT_B_ID,
  roles: ['manager'],
  org_scope_version: 1,
  user_type: 'staff',
});

/** Expired token — exp in the past. */
export const FIXTURE_TOKEN_EXPIRED = mintTestToken({
  sub: AGENT_A_ID,
  tenant_id: TENANT_A_ID,
  roles: ['agent'],
  org_scope_version: 1,
  user_type: 'staff',
  expiresIn: -1, // already expired
});

/** Portal token — should be rejected (wrong user_type). */
export const FIXTURE_TOKEN_PORTAL = mintTestToken({
  sub: 'portal-user-id',
  tenant_id: TENANT_A_ID,
  roles: ['portal_user'],
  org_scope_version: 1,
  user_type: 'portal',
});
