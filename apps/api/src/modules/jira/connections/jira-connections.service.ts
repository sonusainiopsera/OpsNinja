/**
 * JiraConnectionsService — business logic for Jira connection lifecycle.
 *
 * Every mutation writes an audit_logs record via @Auditable on the repository.
 * The OAuth callback path calls withTenantTransaction() directly because it
 * runs from a @Public @NoTenantContext endpoint (Atlassian browser redirect).
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  Logger,
  Inject,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { JiraConnection } from '@opsninja/db';
import { JiraConnectionsRepository } from './jira-connections.repository';
import { JiraOAuthService } from '../oauth/jira-oauth.service';
import { JiraHttpClient } from '../http/jira-http.client';
import { CREDENTIAL_VAULT, type CredentialVaultPort } from '../tokens/credential-vault.service';
import { withTenantTransaction } from '../../../data/unit-of-work';
import type { PrincipalContext } from '../../../observability/request-context';
import type {
  OAuthStartDto,
  CreateApiTokenConnectionDto,
  JiraConnectionResponse,
  OAuthStartResponse,
  TestConnectionResponse,
  PaginatedConnectionsResponse,
} from './dto/jira-connection.dto';

const JIRA_SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'];

@Injectable()
export class JiraConnectionsService {
  private readonly logger = new Logger(JiraConnectionsService.name);

  constructor(
    private readonly repo: JiraConnectionsRepository,
    private readonly oauthService: JiraOAuthService,
    private readonly http: JiraHttpClient,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVaultPort,
  ) {}

  // --------------------------------------------------------------------------
  // OAuth start
  // --------------------------------------------------------------------------

  async startOAuth(
    tenantId: string,
    actorId: string,
    dto: OAuthStartDto,
  ): Promise<OAuthStartResponse> {
    const { authorizationUrl, state, expiresAt, codeVerifier } =
      this.oauthService.buildAuthorizationUrl(tenantId, actorId, dto.redirectUri);

    await this.oauthService.storeState(state, {
      tenantId,
      actorId,
      codeVerifier,
      redirectUri: dto.redirectUri ?? (process.env['JIRA_REDIRECT_URI'] ?? ''),
    });

    return { authorizationUrl, state, expiresAt };
  }

  // --------------------------------------------------------------------------
  // OAuth callback (called from @Public @NoTenantContext endpoint)
  // --------------------------------------------------------------------------

  async handleOAuthCallback(
    code: string,
    state: string,
    traceId: string,
  ): Promise<JiraConnectionResponse> {
    // Consume the state token (single-use, validated against Redis).
    const stateData = await this.oauthService.consumeState(state);

    // Exchange the authorization code for tokens.
    const clientId = process.env['JIRA_CLIENT_ID'] ?? '';
    const clientSecret = process.env['JIRA_CLIENT_SECRET'] ?? '';

    const tokens = await this.http.exchangeCode({
      clientId,
      clientSecret,
      code,
      codeVerifier: stateData.codeVerifier,
      redirectUri: stateData.redirectUri,
    });

    // Resolve the Jira cloud site the user authorized.
    const resources = await this.http.getAccessibleResources(tokens.accessToken);
    const resource = resources[0];
    if (!resource) {
      throw new UnprocessableEntityException({
        error: {
          code: 'JIRA_NO_ACCESSIBLE_RESOURCES',
          message: 'No Jira site was accessible with the granted scopes.',
        },
      });
    }

    // Open a tenant transaction manually (no interceptor here — public endpoint).
    const principal: PrincipalContext = {
      tenantId: stateData.tenantId,
      userId: stateData.actorId,
      principalKind: 'staff',
      roles: ['integration_admin'],
      orgScopeIds: [],
      traceId,
    };

    const connection = await withTenantTransaction(principal, async () => {
      const secretName = `opsninja/${stateData.tenantId}/jira/${randomUUID()}`;
      let secretRef: string;
      try {
        secretRef = await this.vault.store(secretName, tokens.refreshToken, stateData.tenantId);
      } catch (err) {
        throw new UnprocessableEntityException({
          error: {
            code: 'JIRA_CREDENTIAL_STORE_FAILED',
            message: 'Failed to store Jira credentials. Try again or contact support.',
          },
        });
      }

      try {
        return await this.repo.create({
          id: randomUUID(),
          tenantId: stateData.tenantId,
          siteUrl: resource.url,
          cloudId: resource.id,
          authMethod: 'oauth3lo',
          scopes: JIRA_SCOPES,
          secretRef,
          tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // approximate 1h
          state: 'active',
          createdBy: stateData.actorId,
        });
      } catch (err: unknown) {
        // Unique constraint violation — cloud_id already bound.
        if (isUniqueViolation(err)) {
          await this.vault.delete(secretRef).catch(() => undefined); // best-effort cleanup
          throw new ConflictException({
            error: {
              code: 'JIRA_SITE_ALREADY_BOUND',
              message: 'This Jira site is already connected to another tenant.',
            },
          });
        }
        throw err;
      }
    });

    return toResponse(connection);
  }

  // --------------------------------------------------------------------------
  // Create with API token (Data Center)
  // --------------------------------------------------------------------------

  async createWithApiToken(
    tenantId: string,
    actorId: string,
    dto: CreateApiTokenConnectionDto,
  ): Promise<JiraConnectionResponse> {
    const secretName = `opsninja/${tenantId}/jira/${randomUUID()}`;
    // Encode as JSON so email and token travel together but the column holds one ref.
    const secretPayload = JSON.stringify({ email: dto.email, apiToken: dto.apiToken });
    let secretRef: string;
    try {
      secretRef = await this.vault.store(secretName, secretPayload, tenantId);
    } catch {
      throw new UnprocessableEntityException({
        error: {
          code: 'JIRA_CREDENTIAL_STORE_FAILED',
          message: 'Failed to store Jira credentials.',
        },
      });
    }

    try {
      const connection = await this.repo.create({
        id: randomUUID(),
        tenantId,
        siteUrl: dto.siteUrl,
        cloudId: null,
        authMethod: 'api_token',
        scopes: [],
        secretRef,
        tokenExpiresAt: null,
        state: 'active',
        createdBy: actorId,
      });
      return toResponse(connection);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        await this.vault.delete(secretRef).catch(() => undefined);
        throw new ConflictException({
          error: {
            code: 'JIRA_SITE_ALREADY_BOUND',
            message: 'A connection to this Jira site already exists for this tenant.',
          },
        });
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  async list(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedConnectionsResponse> {
    const fetchLimit = Math.min(limit, 100);
    const rows = await this.repo.findPaginated(tenantId, fetchLimit + 1, cursor);
    const hasMore = rows.length > fetchLimit;
    const data = hasMore ? rows.slice(0, fetchLimit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
    return { data: data.map(toResponse), nextCursor };
  }

  // --------------------------------------------------------------------------
  // Get
  // --------------------------------------------------------------------------

  async getById(tenantId: string, id: string): Promise<JiraConnectionResponse> {
    const connection = await this.requireConnection(tenantId, id);
    return toResponse(connection);
  }

  // --------------------------------------------------------------------------
  // Test
  // --------------------------------------------------------------------------

  async testConnection(
    tenantId: string,
    id: string,
    accessToken: string,
  ): Promise<TestConnectionResponse> {
    const connection = await this.requireConnection(tenantId, id);

    const start = Date.now();
    let serverInfo: { version: string; deploymentType: string; baseUrl: string };

    try {
      serverInfo = await this.http.getServerInfo(connection.siteUrl, accessToken);
    } catch (err) {
      // Mark connection as degraded on probe failure.
      await this.repo.updateState(tenantId, id, { state: 'degraded' }).catch(() => undefined);
      throw err;
    }

    const latencyMs = Date.now() - start;

    // Update last tested timestamp and ensure state is active.
    await this.repo.updateState(tenantId, id, {
      state: 'active',
      tokenExpiresAt: connection.tokenExpiresAt ?? undefined,
    }).catch(() => undefined);

    return {
      state: 'active',
      latencyMs,
      jiraVersion: serverInfo.version,
    };
  }

  // --------------------------------------------------------------------------
  // Revoke
  // --------------------------------------------------------------------------

  async revoke(tenantId: string, id: string): Promise<void> {
    const connection = await this.requireConnection(tenantId, id);

    if (connection.state === 'revoked') {
      throw new ConflictException({
        error: {
          code: 'JIRA_CONNECTION_ALREADY_REVOKED',
          message: 'This connection is already revoked.',
        },
      });
    }

    // Crypto-shred the secret material before marking revoked.
    if (connection.secretRef) {
      await this.vault.delete(connection.secretRef).catch((err: unknown) => {
        this.logger.warn('Failed to delete secret during revoke — proceeding with state transition', {
          connectionId: id,
          tenantId,
          error: (err as Error).message,
        });
      });
    }

    await this.repo.revoke(tenantId, id);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async requireConnection(tenantId: string, id: string): Promise<JiraConnection> {
    const connection = await this.repo.findById(tenantId, id);
    if (!connection) {
      throw new NotFoundException({
        error: { code: 'JIRA_CONNECTION_NOT_FOUND', message: 'Jira connection not found.' },
      });
    }
    return connection;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toResponse(connection: JiraConnection): JiraConnectionResponse {
  return {
    id: connection.id,
    siteUrl: connection.siteUrl,
    cloudId: connection.cloudId ?? null,
    authMethod: connection.authMethod,
    scopes: connection.scopes,
    state: connection.state,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    lastTestedAt: connection.lastTestedAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const pgErr = err as { code?: string };
    return pgErr.code === '23505'; // PostgreSQL unique_violation
  }
  return false;
}
