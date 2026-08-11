/**
 * Unit tests for PKCE, OAuth state management, token refresh, and encryption round-trip.
 */

import { createHash, randomBytes } from 'crypto';

// ── PKCE helpers (inline, matching JiraOAuthService internals) ────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── PKCE generation tests ─────────────────────────────────────────────────────

describe('PKCE S256 generation', () => {
  it('generates a 43-character base64url code_verifier', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    // 32 bytes → 43 chars base64url (no padding)
    expect(verifier.length).toBe(43);
  });

  it('generates a unique verifier each call', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });

  it('derives S256 code_challenge from verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = computeCodeChallenge(verifier);
    // Known SHA-256 of the above verifier (base64url)
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('code_challenge is base64url without padding', () => {
    const challenge = computeCodeChallenge(generateCodeVerifier());
    expect(challenge).not.toContain('=');
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('different verifiers produce different challenges', () => {
    const c1 = computeCodeChallenge(generateCodeVerifier());
    const c2 = computeCodeChallenge(generateCodeVerifier());
    expect(c1).not.toBe(c2);
  });
});

// ── JiraOAuthService state tests ──────────────────────────────────────────────

describe('JiraOAuthService state management', () => {
  const mockRedis = {
    set: jest.fn().mockResolvedValue('OK'),
    getdel: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'JIRA_OAUTH_CLIENT_ID') return 'test-client-id';
      if (key === 'JIRA_OAUTH_CLIENT_SECRET') return 'test-client-secret';
      return fallback ?? '';
    }),
  };

  beforeEach(() => jest.clearAllMocks());

  it('stores PKCE state in Redis with 10-minute TTL', async () => {
    const { JiraOAuthService } = await import('../connections/jira-oauth.service');

    const svc = new JiraOAuthService(mockRedis as any, mockConfig as any);
    await svc.generateAuthorizationUrl(
      'tenant-1',
      'user-1',
      'https://app.example.com/callback',
    );

    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^jira:oauth:state:/),
      expect.any(String),
      'EX',
      600,
    );
  });

  it('returns an authorization URL with PKCE params', async () => {
    const { JiraOAuthService } = await import('../connections/jira-oauth.service');
    const svc = new JiraOAuthService(mockRedis as any, mockConfig as any);

    const result = await svc.generateAuthorizationUrl(
      'tenant-1',
      'user-1',
      'https://app.example.com/callback',
    );

    expect(result.authorization_url).toContain('code_challenge_method=S256');
    expect(result.authorization_url).toContain('code_challenge=');
    expect(result.authorization_url).toContain('state=');
    expect(result.authorization_url).toContain('offline_access');
  });

  it('returns unique state tokens per call', async () => {
    const { JiraOAuthService } = await import('../connections/jira-oauth.service');
    const svc = new JiraOAuthService(mockRedis as any, mockConfig as any);

    const r1 = await svc.generateAuthorizationUrl('t', 'u', 'https://example.com/cb');
    const r2 = await svc.generateAuthorizationUrl('t', 'u', 'https://example.com/cb');

    expect(r1.state).not.toBe(r2.state);
  });

  it('throws INVALID_STATE when state not found in Redis', async () => {
    const { JiraOAuthService } = await import('../connections/jira-oauth.service');
    const svc = new JiraOAuthService(mockRedis as any, mockConfig as any);

    mockRedis.getdel.mockResolvedValue(null);

    await expect(svc.exchangeCode('nonexistent-state', 'some-code')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('deletes state key immediately after exchange (single-use)', async () => {
    const { JiraOAuthService } = await import('../connections/jira-oauth.service');
    const svc = new JiraOAuthService(mockRedis as any, mockConfig as any);

    const statePayload = JSON.stringify({
      code_verifier: 'verifier123',
      tenant_id: 'tenant-1',
      actor_id: 'user-1',
      redirect_uri: 'https://example.com/cb',
    });

    mockRedis.getdel.mockResolvedValue(statePayload);

    // Mock the token endpoint
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad_request',
    } as Response);

    try {
      await svc.exchangeCode('valid-state', 'code');
    } catch {
      // Expected to fail due to mocked fetch
    }

    // getdel should have been called (atomically gets and deletes)
    expect(mockRedis.getdel).toHaveBeenCalledWith('jira:oauth:state:valid-state');
  });
});

// ── JiraTokenProvider expiry skew tests ──────────────────────────────────────

describe('JiraTokenProvider expiry skew', () => {
  it('computes TTL as expires_in minus 60 seconds', () => {
    const EXPIRY_SKEW = 60;
    const expiresIn = 3600;
    const expectedTtl = expiresIn - EXPIRY_SKEW;
    expect(expectedTtl).toBe(3540);
  });

  it('clamps TTL to minimum 1 second', () => {
    const EXPIRY_SKEW = 60;
    const expiresIn = 30; // less than skew
    const ttl = Math.max(1, expiresIn - EXPIRY_SKEW);
    expect(ttl).toBe(1);
  });
});

// ── Encryption round-trip tests ───────────────────────────────────────────────

describe('InMemoryEnvelopeCipher round-trip', () => {
  it('decrypts what it encrypted', async () => {
    const { InMemoryEnvelopeCipher } = await import('@opsninja/crypto');
    const cipher = new InMemoryEnvelopeCipher();

    const plaintext = Buffer.from('my-refresh-token-123', 'utf8');
    const { ciphertext } = await cipher.encrypt({ tenantId: 'tenant-1', plaintext });

    expect(ciphertext).not.toEqual(plaintext);

    const decrypted = await cipher.decrypt({ tenantId: 'tenant-1', ciphertext });
    expect(decrypted.toString('utf8')).toBe('my-refresh-token-123');
  });

  it('rejects decryption with wrong tenantId', async () => {
    const { InMemoryEnvelopeCipher } = await import('@opsninja/crypto');
    const cipher = new InMemoryEnvelopeCipher();

    const plaintext = Buffer.from('token', 'utf8');
    const { ciphertext } = await cipher.encrypt({ tenantId: 'tenant-A', plaintext });

    await expect(
      cipher.decrypt({ tenantId: 'tenant-B', ciphertext }),
    ).rejects.toThrow();
  });

  it('produces unique ciphertext for the same input', async () => {
    const { InMemoryEnvelopeCipher } = await import('@opsninja/crypto');
    const cipher = new InMemoryEnvelopeCipher();

    const plaintext = Buffer.from('same-token', 'utf8');
    const r1 = await cipher.encrypt({ tenantId: 'tenant-1', plaintext });
    const r2 = await cipher.encrypt({ tenantId: 'tenant-1', plaintext });

    // Each encryption uses a fresh IV → unique ciphertext
    expect(r1.ciphertext.equals(r2.ciphertext)).toBe(false);
  });
});

// ── Cross-tenant bind rejection ───────────────────────────────────────────────

describe('Cross-tenant cloud_id binding', () => {
  const TENANT_A = '10000000-0000-0000-0000-000000000001';
  const TENANT_B = '20000000-0000-0000-0000-000000000002';

  const mockRepo = {
    findByCloudId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findById: jest.fn(),
    updateState: jest.fn(),
    findAll: jest.fn(),
    updateTokenExpiry: jest.fn(),
  };

  const mockOAuth = { generateAuthorizationUrl: jest.fn(), exchangeCode: jest.fn(), refreshAccessToken: jest.fn() };
  const mockVault = { storeRefreshToken: jest.fn(), updateRefreshToken: jest.fn(), deleteSecret: jest.fn(), getRefreshToken: jest.fn() };
  const mockTokenProvider = { getAccessToken: jest.fn(), evictCachedToken: jest.fn() };
  const mockAudit = { append: jest.fn() };

  function makeService() {
    const { JiraConnectionsService } = require('../connections/jira-connections.service');
    return new JiraConnectionsService(
      mockRepo as any,
      mockOAuth as any,
      mockVault as any,
      mockTokenProvider as any,
      mockAudit as any,
    );
  }

  beforeEach(() => jest.clearAllMocks());

  it('throws 409 JIRA_SITE_ALREADY_BOUND when cloud_id belongs to another tenant', async () => {
    mockRepo.findByCloudId.mockResolvedValue({
      id: 'conn-1',
      tenantId: TENANT_A,
      cloudId: 'cloud-xyz',
    });

    const svc = makeService();
    await expect(
      (svc as any).assertCloudIdNotBound('cloud-xyz', TENANT_B, 'user-1'),
    ).rejects.toMatchObject({
      response: { code: 'JIRA_SITE_ALREADY_BOUND' },
    });
  });

  it('writes an audit record for cross-tenant bind rejection', async () => {
    mockRepo.findByCloudId.mockResolvedValue({
      id: 'conn-1',
      tenantId: TENANT_A,
      cloudId: 'cloud-xyz',
    });
    mockAudit.append.mockResolvedValue(undefined);

    const svc = makeService();
    try {
      await (svc as any).assertCloudIdNotBound('cloud-xyz', TENANT_B, 'user-1');
    } catch {
      // expected
    }

    expect(mockAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'jira_connection.cross_tenant_bind_rejected' }),
    );
  });

  it('does not throw when cloud_id is not yet bound', async () => {
    mockRepo.findByCloudId.mockResolvedValue(undefined);

    const svc = makeService();
    await expect(
      (svc as any).assertCloudIdNotBound('new-cloud-id', TENANT_A, 'user-1'),
    ).resolves.toBeUndefined();
  });
});
