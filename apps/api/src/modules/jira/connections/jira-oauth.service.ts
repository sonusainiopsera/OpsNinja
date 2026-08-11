/**
 * JiraOAuthService – OAuth 2.0 3LO with PKCE S256 for Atlassian.
 *
 * PKCE flow:
 *   1. generateAuthorizationUrl() → stores {code_verifier, tenantId, actorId}
 *      in Redis keyed by state; returns authorization URL with code_challenge.
 *   2. exchangeCode() → validates state, retrieves verifier from Redis, calls
 *      Atlassian token endpoint, returns tokens + cloud resources.
 *
 * State key TTL: 10 minutes (single-use; deleted immediately after exchange).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import {
  AtlassianTokenResponseSchema,
  AtlassianCloudResourcesSchema,
  type AtlassianTokenResponse,
  type AtlassianCloudResource,
} from '../dto/jira-connections.dto';

const STATE_TTL_SECONDS = 600; // 10 minutes
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const DEFAULT_SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'];

interface PkceStatePayload {
  code_verifier: string;
  tenant_id: string;
  actor_id: string;
  redirect_uri: string;
}

interface AuthorizationUrlResult {
  authorization_url: string;
  state: string;
  expires_at: Date;
}

interface TokenExchangeResult {
  tokens: AtlassianTokenResponse;
  cloud_resources: AtlassianCloudResource[];
}

@Injectable()
export class JiraOAuthService {
  private readonly logger = new Logger(JiraOAuthService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.clientId = this.config.get<string>('JIRA_OAUTH_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('JIRA_OAUTH_CLIENT_SECRET', '');
  }

  /**
   * Generates PKCE verifier + challenge, stores state in Redis, returns authorization URL.
   */
  async generateAuthorizationUrl(
    tenantId: string,
    actorId: string,
    redirectUri: string,
    scopes?: string[],
  ): Promise<AuthorizationUrlResult> {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = this.computeChallenge(codeVerifier);
    const state = randomBytes(32).toString('base64url');

    const payload: PkceStatePayload = {
      code_verifier: codeVerifier,
      tenant_id: tenantId,
      actor_id: actorId,
      redirect_uri: redirectUri,
    };

    const stateKey = this.stateKey(state);
    await this.redis.set(stateKey, JSON.stringify(payload), 'EX', STATE_TTL_SECONDS);

    const scopeList = (scopes && scopes.length > 0 ? scopes : DEFAULT_SCOPES).join(' ');

    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.clientId,
      scope: scopeList,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `https://auth.atlassian.com/authorize?${params.toString()}`;
    const expiresAt = new Date(Date.now() + STATE_TTL_SECONDS * 1000);

    this.logger.log({
      operation: 'jira_oauth.start',
      tenantId,
      actorId,
    });

    return { authorization_url: authorizationUrl, state, expires_at: expiresAt };
  }

  /**
   * Validates the state param, exchanges the auth code for tokens, and deletes state.
   * Throws 400-class errors for invalid/expired state.
   */
  async exchangeCode(
    state: string,
    code: string,
  ): Promise<{ tokens: AtlassianTokenResponse; tenantId: string; actorId: string; cloudResources: AtlassianCloudResource[] }> {
    const stateKey = this.stateKey(state);
    const raw = await this.redis.getdel(stateKey);
    if (!raw) {
      throw Object.assign(new Error('INVALID_STATE'), { code: 'INVALID_STATE' });
    }

    let payload: PkceStatePayload;
    try {
      payload = JSON.parse(raw) as PkceStatePayload;
    } catch {
      throw Object.assign(new Error('INVALID_STATE'), { code: 'INVALID_STATE' });
    }

    const { tokens, cloudResources } = await this.callTokenEndpoint(
      code,
      payload.code_verifier,
      payload.redirect_uri,
    );

    return {
      tokens,
      tenantId: payload.tenant_id,
      actorId: payload.actor_id,
      cloudResources,
    };
  }

  private async callTokenEndpoint(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<TokenExchangeResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const response = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      this.logger.warn({ operation: 'jira_oauth.token_exchange_failed', status: response.status });
      throw Object.assign(new Error(`Atlassian token exchange failed: ${response.status}`), {
        code: 'TOKEN_EXCHANGE_FAILED',
        status: response.status,
        detail: errBody.slice(0, 200),
      });
    }

    const raw = await response.json();
    const tokens = AtlassianTokenResponseSchema.parse(raw);

    const cloudResources = await this.fetchCloudResources(tokens.access_token);

    return { tokens, cloudResources };
  }

  /**
   * Fetches the accessible Jira cloud resources for the newly obtained access token.
   */
  async fetchCloudResources(accessToken: string): Promise<AtlassianCloudResource[]> {
    const response = await fetch(ATLASSIAN_RESOURCES_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });

    if (!response.ok) {
      throw Object.assign(new Error('Unable to fetch cloud resources'), {
        code: 'CLOUD_RESOURCES_FAILED',
        status: response.status,
      });
    }

    const raw = await response.json();
    return AtlassianCloudResourcesSchema.parse(raw);
  }

  /**
   * Refreshes an access token using a refresh token.
   */
  async refreshAccessToken(refreshToken: string): Promise<AtlassianTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });

    if (!response.ok) {
      const status = response.status;
      const errBody = await response.text().catch(() => '');
      this.logger.warn({ operation: 'jira_oauth.refresh_failed', status });

      if (status === 400) {
        // invalid_grant — refresh token revoked
        throw Object.assign(new Error('REFRESH_TOKEN_REVOKED'), { code: 'REFRESH_TOKEN_REVOKED', status });
      }
      throw Object.assign(new Error(`Token refresh failed: ${status}`), {
        code: 'TOKEN_REFRESH_FAILED',
        status,
        detail: errBody.slice(0, 200),
      });
    }

    const raw = await response.json();
    return AtlassianTokenResponseSchema.parse(raw);
  }

  private computeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private stateKey(state: string): string {
    return `jira:oauth:state:${state}`;
  }
}
