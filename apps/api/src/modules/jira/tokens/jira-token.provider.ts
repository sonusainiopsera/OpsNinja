/**
 * JiraTokenProvider — Redis-cached, single-flight access-token provider.
 *
 * Design:
 *  - Access tokens are cached under `jira:token:{tenantId}:{connectionId}` with
 *    TTL = expires_in − 60 seconds (the 60s clock-skew buffer).
 *  - A Map of in-flight refresh promises prevents stampede when multiple
 *    concurrent requests trigger a refresh at the same moment.
 *  - Reactive refresh: callers may call refreshFor(tenantId, connectionId) after
 *    receiving a 401 from Jira to force a refresh outside the normal TTL cycle.
 *
 * Security: access tokens are only in Redis (not in the DB); they are evicted
 * automatically when the TTL expires.
 */

import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import { CREDENTIAL_VAULT, type CredentialVaultPort } from './credential-vault.service';
import { JiraHttpClient } from '../http/jira-http.client';
import type { JiraConnectionsRepository } from '../connections/jira-connections.repository';

const EXPIRY_SKEW_SECONDS = 60;

@Injectable()
export class JiraTokenProvider {
  private readonly refreshLocks = new Map<string, Promise<string>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVaultPort,
    private readonly http: JiraHttpClient,
    @Inject('JIRA_CONNECTIONS_REPOSITORY') private readonly repo: JiraConnectionsRepository,
  ) {}

  async getAccessToken(tenantId: string, connectionId: string): Promise<string> {
    const cacheKey = `jira:token:${tenantId}:${connectionId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    return this.singleFlightRefresh(tenantId, connectionId, cacheKey);
  }

  /** Force a token refresh (called after receiving 401 from Jira). */
  async refreshFor(tenantId: string, connectionId: string): Promise<string> {
    const cacheKey = `jira:token:${tenantId}:${connectionId}`;
    await this.redis.del(cacheKey);
    return this.singleFlightRefresh(tenantId, connectionId, cacheKey);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private singleFlightRefresh(tenantId: string, connectionId: string, cacheKey: string): Promise<string> {
    const lockKey = `${tenantId}:${connectionId}`;
    const existing = this.refreshLocks.get(lockKey);
    if (existing) return existing;

    const promise = this.doRefresh(tenantId, connectionId, cacheKey)
      .finally(() => this.refreshLocks.delete(lockKey));

    this.refreshLocks.set(lockKey, promise);
    return promise;
  }

  private async doRefresh(tenantId: string, connectionId: string, cacheKey: string): Promise<string> {
    const connection = await this.repo.findById(tenantId, connectionId);
    if (!connection || connection.state === 'revoked') {
      throw new NotFoundException({
        error: { code: 'JIRA_CONNECTION_NOT_FOUND', message: 'Jira connection not found.' },
      });
    }

    if (!connection.secretRef) {
      throw new NotFoundException({
        error: { code: 'JIRA_NO_CREDENTIAL', message: 'No credential stored for this connection.' },
      });
    }

    const refreshToken = await this.vault.retrieve(connection.secretRef, tenantId);

    const clientId = process.env['JIRA_CLIENT_ID'] ?? '';
    const clientSecret = process.env['JIRA_CLIENT_SECRET'] ?? '';

    const tokens = await this.http.refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken,
    });

    // Store the new refresh token.
    const newSecretRef = await this.vault.store(connection.secretRef, tokens.refreshToken, tenantId);

    // Update DB: new secretRef and expiry.
    const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
    await this.repo.updateState(tenantId, connectionId, {
      secretRef: newSecretRef,
      tokenExpiresAt,
      state: 'active',
    });

    // Cache the access token.
    const ttl = Math.max(1, tokens.expiresIn - EXPIRY_SKEW_SECONDS);
    await this.redis.setex(cacheKey, ttl, tokens.accessToken);

    return tokens.accessToken;
  }
}
