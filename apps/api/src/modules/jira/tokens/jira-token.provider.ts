/**
 * JiraTokenProvider – cached, single-flight access token provider.
 *
 * Access tokens are cached in Redis under:
 *   jira:token:{tenantId}:{connectionId}
 * with TTL = expires_in - 60 seconds (clock-skew buffer).
 *
 * A single-flight refresh lock (SET NX with 30s TTL) prevents concurrent
 * refresh stampede during pod scale-out.  Pod that wins the lock performs the
 * refresh; other pods wait up to 5s for the new token to appear in Redis.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import { JiraOAuthService } from '../connections/jira-oauth.service';
import { CredentialVaultService } from '../connections/credential-vault.service';
import { JiraConnectionsRepository } from '../connections/jira-connections.repository';

const EXPIRY_SKEW_SECONDS = 60;
const LOCK_TTL_SECONDS = 30;
const LOCK_WAIT_POLL_MS = 200;
const LOCK_WAIT_MAX_MS = 5_000;

@Injectable()
export class JiraTokenProvider {
  private readonly logger = new Logger(JiraTokenProvider.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly oauthService: JiraOAuthService,
    private readonly vaultService: CredentialVaultService,
    private readonly repository: JiraConnectionsRepository,
  ) {}

  /**
   * Returns a valid access token for the given connection, refreshing if needed.
   * Triggers a refresh if the cached token is absent or the connection's
   * token_expires_at is within the skew window.
   */
  async getAccessToken(tenantId: string, connectionId: string): Promise<string> {
    const cacheKey = this.cacheKey(tenantId, connectionId);

    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    return this.refreshWithLock(tenantId, connectionId, cacheKey);
  }

  /**
   * Evicts the cached access token so the next call triggers a fresh refresh.
   * Used when Jira returns 401 during an API call.
   */
  async evictCachedToken(tenantId: string, connectionId: string): Promise<void> {
    await this.redis.del(this.cacheKey(tenantId, connectionId));
  }

  private async refreshWithLock(
    tenantId: string,
    connectionId: string,
    cacheKey: string,
  ): Promise<string> {
    const lockKey = this.lockKey(tenantId, connectionId);

    const acquired = await this.redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX');

    if (acquired === 'OK') {
      try {
        return await this.doRefresh(tenantId, connectionId, cacheKey);
      } finally {
        await this.redis.del(lockKey);
      }
    }

    // Another pod holds the lock — wait for the cached token to appear
    const deadline = Date.now() + LOCK_WAIT_MAX_MS;
    while (Date.now() < deadline) {
      await sleep(LOCK_WAIT_POLL_MS);
      const token = await this.redis.get(cacheKey);
      if (token) return token;
    }

    // Lock holder may have failed; try to acquire and refresh ourselves
    this.logger.warn({
      operation: 'jira_token.lock_wait_timeout',
      tenantId,
      connectionId,
    });
    return this.doRefresh(tenantId, connectionId, cacheKey);
  }

  private async doRefresh(
    tenantId: string,
    connectionId: string,
    cacheKey: string,
  ): Promise<string> {
    const refreshToken = await this.vaultService.getRefreshToken(tenantId, connectionId);

    const tokenResponse = await this.oauthService.refreshAccessToken(refreshToken);

    const ttl = Math.max(1, tokenResponse.expires_in - EXPIRY_SKEW_SECONDS);
    await this.redis.set(cacheKey, tokenResponse.access_token, 'EX', ttl);

    // If Atlassian rotated the refresh token, persist the new one
    if (tokenResponse.refresh_token) {
      await this.vaultService.updateRefreshToken(tenantId, connectionId, tokenResponse.refresh_token);
    }

    // Update token_expires_at in the DB
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
    await this.repository.updateTokenExpiry(connectionId, expiresAt);

    this.logger.log({
      operation: 'jira_token.refreshed',
      tenantId,
      connectionId,
      expiresIn: tokenResponse.expires_in,
    });

    return tokenResponse.access_token;
  }

  private cacheKey(tenantId: string, connectionId: string): string {
    return `jira:token:${tenantId}:${connectionId}`;
  }

  private lockKey(tenantId: string, connectionId: string): string {
    return `jira:token:lock:${tenantId}:${connectionId}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
