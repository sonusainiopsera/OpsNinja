/**
 * IdP connection fixtures for integration tests.
 *
 * Seeds two per-tenant IdP connections (one per fixture tenant) into the
 * idp_connections table. The client_secret_ref points to an in-memory
 * SecretsProvider key used in tests; no real secrets are committed.
 */

import type { Sql } from 'postgres';
import { FIXTURE_IDS } from '../../../../packages/db/test/fixtures/identity.fixtures.js';

// Secret references used in tests (resolved via InMemorySecretsProvider)
export const IDP_SECRET_REFS = {
  TENANT_A: 'test/tenant-a/oidc-secret',
  TENANT_B: 'test/tenant-b/oidc-secret',
} as const;

export const IDP_SECRET_VALUES = {
  [IDP_SECRET_REFS.TENANT_A]: 'secret-for-tenant-a',
  [IDP_SECRET_REFS.TENANT_B]: 'secret-for-tenant-b',
} as const;

export async function loadIdpConnectionFixtures(
  sql: Sql,
  tenantAIssuer: string,
  tenantBIssuer: string,
  redirectUri: string,
): Promise<void> {
  await sql.unsafe(`
    INSERT INTO idp_connections
      (tenant_id, id, issuer, client_id, client_secret_ref,
       scopes, allowed_email_domains, redirect_uri, enabled)
    VALUES
      ($1::uuid, gen_random_uuid(), $2, 'test-client-id', $3,
       ARRAY['openid','email','profile'],
       ARRAY['fixture-a.example'], $4, true),
      ($5::uuid, gen_random_uuid(), $6, 'test-client-id-b', $7,
       ARRAY['openid','email','profile'],
       ARRAY['fixture-b.example'], $4, true)
    ON CONFLICT DO NOTHING
  `, [
    FIXTURE_IDS.TENANT_A, tenantAIssuer, IDP_SECRET_REFS.TENANT_A, redirectUri,
    FIXTURE_IDS.TENANT_B, tenantBIssuer, IDP_SECRET_REFS.TENANT_B,
  ]);
}
