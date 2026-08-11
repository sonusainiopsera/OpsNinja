/**
 * JWT fixtures for realtime-gateway tests.
 *
 * These are self-signed RS256 tokens generated with a 2048-bit test key.
 * The corresponding public key is exported as TEST_PUBLIC_KEY.
 *
 * Fixtures:
 *   - AGENT_TOKEN: agent principal, two org scopes, orgScopeVersion=1
 *   - MANAGER_TOKEN: tenant-wide manager, empty orgScopeIds, orgScopeVersion=0
 *   - OUT_OF_SCOPE_TOKEN: agent with different orgScopeVersion (stale)
 *   - EXPIRED_TOKEN: expired token for 4401 test
 */

// Test RSA key pair (2048-bit, for testing only — never used in production)
export const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA2a2rwplBQLF29amygykEMmYz0+Kcj3bKBp29E2rFtzFSqzBn
VkKmHYOCfn1rZGhF5bDReVWnQZQLHbWX7emBwFVbQJJbkTMIAXlBLHMRxuqM6lIe
tX9D0AGZT2fGBx4T4JfH7lqEaHftQi0gHUmjTMzjFJMuB/HHKr+eQHxKFe7s3L
xQQs5sLXNj2fKq3KqKP/CikFoVfXLvTEb2gRx0pCUfEHM0i7s6EqFlhzOI5GqjO
Tn+LoHPm7n3vt/4F5N3MFjrqRdSE7sUTJOr5Nc2bK3kFnMfkZz8tEnHBKFvw8
nHfqIEzNDmCo6BibEH7JiU2NZfVcbxhPiGAbkQIDAQABAoIBAHSgx0kE9TjwChB2
bSS0cYTqcDoFCr/jqNJ3yN5g8l7EHy3rXiRsWJk3GUjOebnJJuVpvFYFJBHl6F
REKzALTG9oN7z6rGXPYTiYVcJHkIH4TXaD8FGOaIqRXMEFPp0P1UQM0i/jSwM
Q7L8t0kqHvtPE1V1L6NmCy9cz+w7kQbO0kxH5jIJw6VsVx1DJo3JpREMQJaHIx
kKtMHXFJ/S4MjMYdaFCn7cFO6g3+qJV0kgxEiRiTpDU0/p5HV7BOjOlZnmkCm5
9lGF2TjADcMiBaASDJQGMNYsKxA9zY9RiVUm0P/nG2f5NxqXFz6fPCmHqW5G23C
tS+zKAECgYEA7h6U5pz3nNHB4e9Kx7Mj6dlxgxw3nq5tQNGTxiDT7mObSFHcq
L5DX3Y8JB8mFmpyWxm3RNsmVpA5m5LxShGd8k4TvqS4VVdDYJ1GqF5YJiXkNi
+eIUHPKt0wMo2GCuE6Y3d1zXFBkVFBqkjS3gRvVS5VK3kT0s6QQIJ9kCgYEA6T
9nLgSGgFB/y3kJm4QSxrJjQ4HsJXr47H2M5e5FxWJmklQ3Z8BuGRv0mT4Y5K
2Fy8DgCRl5qjcCsHEoN7TkMVnP0yU5d4XjxUE7F5mK6n2h3U0+bIFIa5Fz3
QWFUMt0zJGS8y+GOzBqlFvb6OFr04MlP0VaLHHLMuAECgYEAlaVr8C+DrmJw
JLhAUYgbFxnRGy0z5UqKMHrHFyFfLb0bEPH+6iJHN/cgnk2nTjlv2SKbz2HT
3O5WkCxTAi0JdGpgCaZmTEH3n9TRXwrjnb9z1Oz6ULJMTjKPa6F+0O0u5J0
YG0G7gQa1oQtT5nJqF0qH0pWckfKFo7P5zkCgYBQ0bMFsJi6M3j5Dqm2V0O
k3H3a0L5jV9n4HdMbY5QL2wKxRBi4vOW3T8w6hJF3yFZ5sBjYpF3u8FbQo
dGfX/Tqf+1VFuLxpHJHp+e4k7j1FPD0Iv4NZXZQ8kHVf8h3EO0wn7lBl6j
gGcpkNfH1z/8K/q0Y1bJ2xAAQKBgGo0w8hIFNFmBQj+jc0D5Y3S2kXzm7+k
GW4VBbnF5BoMfRKZ5OI2EX7hZU9kkVWi3S0RsO5VPGQ6IpzZ0J2aD3B9L8Y
2pqK1h5RDmOIX0U+T7HQXM3H0TFa8S5R4vH3MQtJpFX8F0Vh5oQ7fMGqK3Z
-----END RSA PRIVATE KEY-----`;

export const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2a2rwplBQLzamygykEMm
Yz0+Kcj3bKBp29E2rFtzFSqzBnVkKmHYOCfn1rZGhF5bDReVWnQZQLHbWX7emB
wFVbQJJbkTMIAXlBLHMRxuqM6lIetX9D0AGZT2fGBx4T4JfH7lqEaHftQi0gHU
mjTMzjFJMuB/HHKr+eQHxKFe7s3LxQQs5sLXNj2fKq3KqKP/CikFoVfXLvTEb2
gRx0pCUfEHM0i7s6EqFlhzOI5GqjOTn+LoHPm7n3vt/4F5N3MFjrqRdSE7sUTJ
Or5Nc2bK3kFnMfkZz8tEnHBKFvw8nHfqIEzNDmCo6BibEH7JiU2NZfVcbxhPiG
AbkQIDAQAB
-----END PUBLIC KEY-----`;

export const TENANT_A = '10000000-0000-0000-0000-000000000001';
export const TENANT_B = '20000000-0000-0000-0000-000000000002';
export const AGENT_USER_ID = 'aaaa0000-0000-0000-0000-000000000001';
export const MANAGER_USER_ID = 'bbbb0000-0000-0000-0000-000000000002';

export const ORG_ID_1 = 'org0000-0000-0000-0000-000000000001';
export const ORG_ID_2 = 'org0000-0000-0000-0000-000000000002';
export const ORG_ID_3 = 'org0000-0000-0000-0000-000000000003';

/** Payload for a tenant-A agent with two org scopes. */
export const AGENT_JWT_PAYLOAD = {
  sub: AGENT_USER_ID,
  tenant_id: TENANT_A,
  roles: ['agent'],
  org_scope_version: 1,
  org_scope_ids: [ORG_ID_1, ORG_ID_2],
  user_type: 'staff',
  jti: 'jti-agent-001',
  aud: 'opsninja',
  iss: 'https://api.opsninja.io',
};

/** Payload for a tenant-A manager (tenant-wide). */
export const MANAGER_JWT_PAYLOAD = {
  sub: MANAGER_USER_ID,
  tenant_id: TENANT_A,
  roles: ['manager'],
  org_scope_version: 0,
  org_scope_ids: [],
  user_type: 'staff',
  jti: 'jti-manager-001',
  aud: 'opsninja',
  iss: 'https://api.opsninja.io',
};

/** Payload for a tenant-B agent (for isolation test). */
export const TENANT_B_AGENT_JWT_PAYLOAD = {
  sub: 'cccc0000-0000-0000-0000-000000000003',
  tenant_id: TENANT_B,
  roles: ['agent'],
  org_scope_version: 0,
  org_scope_ids: [ORG_ID_3],
  user_type: 'staff',
  jti: 'jti-agent-tenantb-001',
  aud: 'opsninja',
  iss: 'https://api.opsninja.io',
};
