/**
 * Mock OIDC provider for integration tests.
 *
 * Provides:
 *   - A fixed RSA-256 keypair generated once per test run.
 *   - An in-process HTTP server serving OIDC discovery + JWKS endpoints.
 *   - issueIdToken() to generate valid sample ID tokens.
 *   - Fixtures: two sample users across two tenants.
 *
 * Usage:
 *   const provider = await MockOidcProvider.start();
 *   // ... run tests using provider.issuer and provider.issueIdToken()
 *   await provider.stop();
 */

import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, type KeyLike } from 'jose';
import { SignJWT } from 'jose';

// ---------------------------------------------------------------------------
// Static test fixtures
// ---------------------------------------------------------------------------

export const MOCK_USERS = {
  STAFF_A: {
    sub:    'oidc-sub-staff-a',
    email:  'agent@fixture-a.example',
    name:   'Agent A',
    domain: 'fixture-a.example',
  },
  STAFF_B: {
    sub:    'oidc-sub-staff-b',
    email:  'admin@fixture-b.example',
    name:   'Admin B',
    domain: 'fixture-b.example',
  },
  UNREGISTERED: {
    sub:    'oidc-sub-unknown',
    email:  'user@unregistered-domain.example',
    name:   'Unknown User',
    domain: 'unregistered-domain.example',
  },
} as const;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class MockOidcProvider {
  private readonly server: Server;
  private readonly privateKey: KeyLike;
  private readonly publicKey: KeyLike;
  private readonly kid: string;
  private _issuer: string;

  private constructor(
    server: Server,
    privateKey: KeyLike,
    publicKey: KeyLike,
    kid: string,
    issuer: string,
  ) {
    this.server = server;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.kid = kid;
    this._issuer = issuer;
  }

  get issuer(): string { return this._issuer; }
  get discoveryUrl(): string { return `${this._issuer}/.well-known/openid-configuration`; }
  get jwksUrl(): string { return `${this._issuer}/.well-known/jwks.json`; }
  get tokenUrl(): string { return `${this._issuer}/token`; }
  get authUrl(): string { return `${this._issuer}/authorize`; }

  /**
   * Starts the mock OIDC provider server on an ephemeral port.
   */
  static async start(): Promise<MockOidcProvider> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const kid = 'mock-key-001';

    const server = createServer();
    const provider = new MockOidcProvider(server, privateKey, publicKey, kid, '');

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as { port: number };
    provider._issuer = `http://127.0.0.1:${addr.port}`;

    server.on('request', async (req, res) => {
      const url = req.url ?? '/';

      if (url === '/.well-known/openid-configuration') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          issuer:                 provider._issuer,
          authorization_endpoint: provider.authUrl,
          token_endpoint:         provider.tokenUrl,
          jwks_uri:               provider.jwksUrl,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        }));
        return;
      }

      if (url === '/.well-known/jwks.json') {
        const jwk = await exportJWK(publicKey);
        jwk['kid'] = kid;
        jwk['use'] = 'sig';
        jwk['alg'] = 'RS256';
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }

      if (url === '/token' && req.method === 'POST') {
        // Collect body
        let body = '';
        for await (const chunk of req) body += chunk;
        const params = new URLSearchParams(body);
        const code = params.get('code');

        if (!code) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }

        // Decode the mock code as JSON with user info
        let userInfo: { sub: string; email: string; name: string; nonce?: string };
        try {
          userInfo = JSON.parse(Buffer.from(code, 'base64url').toString()) as typeof userInfo;
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }

        const idToken = await provider.issueIdToken(
          userInfo.sub,
          userInfo.email,
          userInfo.name,
          userInfo.nonce,
        );

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          access_token: 'mock-access-token',
          token_type: 'bearer',
          id_token: idToken,
        }));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    return provider;
  }

  /**
   * Issues a signed RS256 ID token for a test user.
   */
  async issueIdToken(
    sub: string,
    email: string,
    name: string,
    nonce?: string,
    overrides?: Record<string, unknown>,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      sub,
      email,
      email_verified: true,
      name,
      iat: now,
      exp: now + 600, // 10 min
      iss: this._issuer,
      aud: 'test-client-id',
      ...overrides,
    };
    if (nonce) payload['nonce'] = nonce;

    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: this.kid })
      .sign(this.privateKey);
  }

  /**
   * Generates a mock authorization code that encodes the user payload.
   * The token endpoint decodes this to produce the ID token.
   */
  generateAuthCode(
    user: { sub: string; email: string; name: string },
    nonce?: string,
  ): string {
    return Buffer.from(JSON.stringify({ ...user, nonce })).toString('base64url');
  }

  /**
   * Stops the server.
   */
  stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
