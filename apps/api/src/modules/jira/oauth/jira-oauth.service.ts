/**
 * JiraOAuthService — OAuth 2.0 (3LO) authorization-code-with-PKCE flow.
 *
 * Security invariants:
 *  - PKCE S256: code_verifier is 32 random bytes (base64url); code_challenge
 *    is SHA-256(verifier) base64url — never exposed to the browser.
 *  - State token is a UUID stored in Redis with 10-minute TTL; single-use
 *    (consumed on the first valid callback).
 *  - code_verifier and code are PII-tier: they must not appear in logs.
 *    The log redactor covers 'code_verifier' and 'code' keys.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';

const STATE_TTL_SECONDS = 600; // 10 minutes
const DEFAULT_SCOPES = [
  'read:jira-work',
  'write:jira-work',
  'read:jira-user',
  'offline_access',
];

export interface OAuthStateData {
  tenantId: string;
  actorId: string;
  codeVerifier: string;
  redirectUri: string;
}

@Injectable()
export class JiraOAuthService {
  private readonly clientId: string;
  private readonly defaultRedirectUri: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.clientId = process.env['JIRA_CLIENT_ID'] ?? '';
    this.defaultRedirectUri = process.env['JIRA_REDIRECT_URI'] ?? 'http://localhost:3000/api/v1/integrations/jira/connections/oauth/callback';
  }

  buildAuthorizationUrl(tenantId: string, actorId: string, redirectUri?: string): {
    authorizationUrl: string;
    state: string;
    expiresAt: string;
    codeVerifier: string;
  } {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.computeS256Challenge(codeVerifier);
    const state = randomUUID();
    const resolvedRedirectUri = redirectUri ?? this.defaultRedirectUri;

    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.clientId,
      scope: DEFAULT_SCOPES.join(' '),
      redirect_uri: resolvedRedirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `https://auth.atlassian.com/authorize?${params.toString()}`;
    const expiresAt = new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString();

    return { authorizationUrl, state, expiresAt, codeVerifier };
  }

  async storeState(state: string, data: OAuthStateData): Promise<void> {
    await this.redis.set(
      `jira:state:${state}`,
      JSON.stringify(data),
      'EX',
      STATE_TTL_SECONDS,
    );
  }

  async consumeState(state: string): Promise<OAuthStateData> {
    const raw = await this.redis.get(`jira:state:${state}`);
    if (!raw) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_STATE',
          message: 'OAuth state token is invalid or expired. Start a new OAuth flow.',
        },
      });
    }
    // Single-use: delete immediately after reading.
    await this.redis.del(`jira:state:${state}`);
    return JSON.parse(raw) as OAuthStateData;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  private computeS256Challenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }
}
