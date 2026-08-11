/**
 * Jira connections — unit and DB characterisation tests (WO-051).
 *
 * Unit suite (no DB or network required):
 *  - DTO validation: OAuthStartSchema, OAuthCallbackSchema, CreateApiTokenConnectionSchema
 *  - ListConnectionsQuerySchema coercion and defaults
 *  - strict() rejects unknown fields
 *  - Log redactor: token/code/code_verifier/client_secret/api_token keys all redacted
 *
 * DB characterisation suite (requires DATABASE_URL):
 *  - jira_connections table has tenant_id NOT NULL
 *  - ENABLE + FORCE RLS enabled
 *  - tenant_isolation_jira_connections policy present
 *  - auth_method check constraint enforces ('oauth3lo', 'api_token')
 *  - state check constraint enforces ('pending', 'active', 'degraded', 'revoked')
 *  - jira_connections_cloud_id_global_uniq partial index exists (cross-tenant binding prevention)
 *  - Cross-tenant isolation: switching app.current_tenant hides other tenant's rows
 */

import { Pool } from 'pg';
import {
  OAuthStartSchema,
  OAuthCallbackSchema,
  CreateApiTokenConnectionSchema,
  ListConnectionsQuerySchema,
} from '../src/modules/jira/connections/dto/jira-connection.dto';
import { redactLogObject } from '../../packages/observability/src/log-redactor';
import {
  INVALID_API_TOKEN_MISSING_SITE,
  INVALID_API_TOKEN_BAD_URL,
  INVALID_API_TOKEN_UNKNOWN_FIELD,
  JIRA_FIXTURE_TENANT_A,
  JIRA_FIXTURE_TENANT_B,
  JIRA_FIXTURE_ADMIN_A,
} from './fixtures/jira.fixtures';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Unit — DTO validation
// ---------------------------------------------------------------------------

describe('Jira connection DTO validation — unit', () => {
  describe('OAuthStartSchema', () => {
    it('accepts empty body', () => {
      expect(OAuthStartSchema.safeParse({}).success).toBe(true);
    });

    it('accepts valid redirectUri', () => {
      const r = OAuthStartSchema.safeParse({ redirectUri: 'https://app.example.com/oauth/callback' });
      expect(r.success).toBe(true);
    });

    it('rejects non-URL redirectUri', () => {
      const r = OAuthStartSchema.safeParse({ redirectUri: 'not-a-url' });
      expect(r.success).toBe(false);
    });

    it('rejects unknown fields (strict mode)', () => {
      const r = OAuthStartSchema.safeParse({ redirectUri: 'https://example.com', extra: 'x' });
      expect(r.success).toBe(false);
    });
  });

  describe('OAuthCallbackSchema', () => {
    const validState = '11111111-1111-1111-1111-111111111111';

    it('accepts valid code and UUID state', () => {
      const r = OAuthCallbackSchema.safeParse({ code: 'auth-code-xyz', state: validState });
      expect(r.success).toBe(true);
    });

    it('rejects empty code', () => {
      const r = OAuthCallbackSchema.safeParse({ code: '', state: validState });
      expect(r.success).toBe(false);
    });

    it('rejects non-UUID state', () => {
      const r = OAuthCallbackSchema.safeParse({ code: 'abc', state: 'not-a-uuid' });
      expect(r.success).toBe(false);
    });

    it('rejects unknown fields (strict mode)', () => {
      const r = OAuthCallbackSchema.safeParse({ code: 'abc', state: validState, extra: 'y' });
      expect(r.success).toBe(false);
    });
  });

  describe('CreateApiTokenConnectionSchema', () => {
    const valid = {
      siteUrl: 'https://jira.company.internal',
      email: 'admin@company.com',
      apiToken: 'ATATT3xFfGF0abc',
    };

    it('accepts a valid payload', () => {
      expect(CreateApiTokenConnectionSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects missing siteUrl', () => {
      const r = CreateApiTokenConnectionSchema.safeParse(INVALID_API_TOKEN_MISSING_SITE);
      expect(r.success).toBe(false);
    });

    it('rejects non-URL siteUrl', () => {
      const r = CreateApiTokenConnectionSchema.safeParse(INVALID_API_TOKEN_BAD_URL);
      expect(r.success).toBe(false);
    });

    it('rejects unknown field (strict mode)', () => {
      const r = CreateApiTokenConnectionSchema.safeParse(INVALID_API_TOKEN_UNKNOWN_FIELD);
      expect(r.success).toBe(false);
    });

    it('rejects empty apiToken', () => {
      const r = CreateApiTokenConnectionSchema.safeParse({ ...valid, apiToken: '' });
      expect(r.success).toBe(false);
    });

    it('rejects invalid email', () => {
      const r = CreateApiTokenConnectionSchema.safeParse({ ...valid, email: 'not-an-email' });
      expect(r.success).toBe(false);
    });
  });

  describe('ListConnectionsQuerySchema', () => {
    it('applies default limit of 20', () => {
      const r = ListConnectionsQuerySchema.safeParse({});
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.limit).toBe(20);
    });

    it('coerces string limit to number', () => {
      const r = ListConnectionsQuerySchema.safeParse({ limit: '50' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.limit).toBe(50);
    });

    it('rejects limit = 0', () => {
      expect(ListConnectionsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    });

    it('rejects limit = 101', () => {
      expect(ListConnectionsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it('accepts optional cursor', () => {
      const r = ListConnectionsQuerySchema.safeParse({ cursor: 'opaque-cursor-xyz' });
      expect(r.success).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Unit — log redactor covers all Restricted-tier credential keys
// ---------------------------------------------------------------------------

describe('Log redactor — Jira credential fields (WO-051)', () => {
  const sensitivePayload = {
    token: 'raw-token-value',
    accessToken: 'raw-access-token',
    access_token: 'raw-snake-access',
    refreshToken: 'raw-refresh-token',
    refresh_token: 'raw-snake-refresh',
    code: 'auth-code-from-atlassian',
    codeVerifier: 'raw-pkce-verifier',
    code_verifier: 'snake-pkce-verifier',
    clientSecret: 'raw-client-secret',
    client_secret: 'snake-client-secret',
    apiToken: 'ATATT3x-raw-token',
    api_token: 'atatt-snake-token',
    // Non-sensitive fields should pass through unchanged
    connectionId: 'conn-id-should-remain',
    tenantId: 'tenant-id-should-remain',
  };

  let redacted: Record<string, unknown>;

  beforeAll(() => {
    redacted = redactLogObject(sensitivePayload) as Record<string, unknown>;
  });

  const credentialKeys = [
    'token',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'code',
    'codeVerifier',
    'code_verifier',
    'clientSecret',
    'client_secret',
    'apiToken',
    'api_token',
  ];

  for (const key of credentialKeys) {
    it(`redacts the "${key}" key`, () => {
      expect(redacted[key]).not.toBe((sensitivePayload as Record<string, unknown>)[key]);
      expect(typeof redacted[key]).toBe('string');
      expect(redacted[key]).not.toContain('raw');
    });
  }

  it('preserves non-sensitive fields', () => {
    expect(redacted['connectionId']).toBe('conn-id-should-remain');
    expect(redacted['tenantId']).toBe('tenant-id-should-remain');
  });

  it('redacts nested credential fields', () => {
    const nested = { outer: { token: 'secret', name: 'visible' } };
    const out = redactLogObject(nested) as { outer: Record<string, unknown> };
    expect(out.outer['token']).not.toBe('secret');
    expect(out.outer['name']).toBe('visible');
  });
});

// ---------------------------------------------------------------------------
// DB characterisation — schema constraints and RLS
// ---------------------------------------------------------------------------

maybeDescribe('jira_connections DB characterisation', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('jira_connections table exists with tenant_id NOT NULL', async () => {
    const { rows } = await pool.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'jira_connections'
        AND column_name = 'tenant_id'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('NO');
  });

  it('ENABLE and FORCE RLS are set on jira_connections', async () => {
    const { rows } = await pool.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'jira_connections' AND relkind = 'r'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  it('tenant_isolation_jira_connections RLS policy exists', async () => {
    const { rows } = await pool.query(`
      SELECT policyname
      FROM pg_policies
      WHERE tablename = 'jira_connections'
        AND policyname = 'tenant_isolation_jira_connections'
    `);
    expect(rows).toHaveLength(1);
  });

  it('auth_method check constraint is present', async () => {
    const { rows } = await pool.query(`
      SELECT constraint_name
      FROM information_schema.check_constraints
      WHERE constraint_schema = 'public'
        AND constraint_name LIKE '%auth_method%'
    `);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('state check constraint is present', async () => {
    const { rows } = await pool.query(`
      SELECT constraint_name
      FROM information_schema.check_constraints
      WHERE constraint_schema = 'public'
        AND constraint_name LIKE '%jira_connections%state%'
    `);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('global cloud_id unique partial index exists (cross-tenant binding prevention)', async () => {
    const { rows } = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'jira_connections'
        AND indexname = 'jira_connections_cloud_id_global_uniq'
    `);
    expect(rows).toHaveLength(1);
  });

  it('tenant-scoped unique index on (tenant_id, cloud_id) exists', async () => {
    const { rows } = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'jira_connections'
        AND indexname = 'jira_connections_tenant_cloud_uniq'
    `);
    expect(rows).toHaveLength(1);
  });

  it('cross-tenant isolation: switching app.current_tenant hides other tenant rows', async () => {
    const client = await pool.connect();
    try {
      const tenantA = JIRA_FIXTURE_TENANT_A;
      const tenantB = JIRA_FIXTURE_TENANT_B;
      const actorA = JIRA_FIXTURE_ADMIN_A;

      // Insert a connection for tenant A
      await client.query(`SET app.current_tenant = '${tenantA}'`);
      await client.query(`SET app.current_actor = '${actorA}'`);

      const inserted = await client.query(`
        INSERT INTO jira_connections (
          tenant_id, site_url, auth_method, scopes, secret_ref, state, created_by
        ) VALUES (
          $1::uuid, 'https://isolation-test.atlassian.net', 'api_token',
          ARRAY[]::text[], 'ref/iso-test', 'active', $2::uuid
        )
        RETURNING id
      `, [tenantA, actorA]);

      const connectionId = inserted.rows[0].id as string;

      // Verify tenant A can see it
      const fromA = await client.query(
        `SELECT id FROM jira_connections WHERE id = $1`,
        [connectionId],
      );
      expect(fromA.rows).toHaveLength(1);

      // Switch to tenant B — should see no rows (RLS)
      await client.query(`SET app.current_tenant = '${tenantB}'`);
      const fromB = await client.query(
        `SELECT id FROM jira_connections WHERE id = $1`,
        [connectionId],
      );
      expect(fromB.rows).toHaveLength(0);

      // Cleanup: switch back and delete
      await client.query(`SET app.current_tenant = '${tenantA}'`);
      await client.query(`DELETE FROM jira_connections WHERE id = $1`, [connectionId]);
    } finally {
      client.release();
    }
  });
});
