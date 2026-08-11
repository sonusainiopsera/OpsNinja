import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RequestContextStore } from '../../../observability/request-context';
import { AuditWriter } from '../../../common/audit/audit-writer';
import { assertFound } from '../../../common/errors/not-found';
import { JiraConnectionsRepository } from './jira-connections.repository';
import { JiraOAuthService } from './jira-oauth.service';
import { CredentialVaultService } from './credential-vault.service';
import { JiraTokenProvider } from '../tokens/jira-token.provider';
import {
  JiraServerInfoSchema,
  type StartOAuthDto,
  type OAuthCallbackQuery,
  type CreateApiTokenConnectionDto,
  type ListConnectionsQuery,
  type ConnectionResponse,
  type ListConnectionsResponse,
  type StartOAuthResponse,
  type TestConnectionResponse,
} from '../dto/jira-connections.dto';
import type { JiraConnection } from '@opsninja/db';

const JIRA_SERVERINFO_PATH = '/rest/api/3/serverInfo';
const HTTP_TIMEOUT_MS = 20_000;

/** PostgreSQL unique_violation SQLSTATE code. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

function isGlobalCloudIdViolation(err: unknown): boolean {
  const detail = ((err as { detail?: string }).detail ?? '').toLowerCase();
  const constraint = ((err as { constraint?: string }).constraint ?? '').toLowerCase();
  return (
    constraint.includes('global_cloud_id') ||
    detail.includes('global_cloud_id')
  );
}

@Injectable()
export class JiraConnectionsService {
  private readonly logger = new Logger(JiraConnectionsService.name);

  constructor(
    private readonly repository: JiraConnectionsRepository,
    private readonly oauthService: JiraOAuthService,
    private readonly vaultService: CredentialVaultService,
    private readonly tokenProvider: JiraTokenProvider,
    private readonly auditWriter: AuditWriter,
  ) {}

  // ── OAuth start ─────────────────────────────────────────────────────────────

  async startOAuth(dto: StartOAuthDto): Promise<StartOAuthResponse> {
    const principal = RequestContextStore.getPrincipal();

    const result = await this.oauthService.generateAuthorizationUrl(
      principal.tenantId,
      principal.userId,
      dto.redirect_uri,
      dto.scopes,
    );

    return {
      authorization_url: result.authorization_url,
      state: result.state,
      expires_at: result.expires_at.toISOString(),
    };
  }

  // ── OAuth callback ──────────────────────────────────────────────────────────

  async handleOAuthCallback(query: OAuthCallbackQuery): Promise<ConnectionResponse> {
    let exchangeResult: Awaited<ReturnType<JiraOAuthService['exchangeCode']>>;
    try {
      exchangeResult = await this.oauthService.exchangeCode(query.state, query.code);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_STATE') {
        throw new UnprocessableEntityException({
          code: 'INVALID_STATE',
          message: 'The OAuth state is invalid or has expired. Please restart the authorization flow.',
        });
      }
      throw err;
    }

    const { tokens, tenantId, actorId, cloudResources } = exchangeResult;

    const cloudResource = cloudResources[0];
    if (!cloudResource) {
      throw new UnprocessableEntityException({
        code: 'NO_CLOUD_RESOURCE',
        message: 'No accessible Jira cloud resources were found for this authorization.',
      });
    }

    await this.assertCloudIdNotBound(cloudResource.id, tenantId, actorId);

    const refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      throw new UnprocessableEntityException({
        code: 'MISSING_REFRESH_TOKEN',
        message: 'Atlassian did not return a refresh token. Ensure offline_access scope is requested.',
      });
    }

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Create connection in pending state first (need the ID for vault path)
    let connection: JiraConnection;
    try {
      connection = await this.repository.create({
        tenantId,
        siteUrl: cloudResource.url,
        cloudId: cloudResource.id,
        authMethod: 'oauth3lo',
        scopes: cloudResource.scopes,
        secretRef: 'pending',
        tokenExpiresAt,
        state: 'pending',
        createdBy: actorId,
      });
    } catch (err) {
      if (isUniqueViolation(err) && isGlobalCloudIdViolation(err)) {
        // Cross-tenant bind rejected by global unique index
        await this.auditWriter.append({
          action: 'jira_connection.cross_tenant_bind_rejected',
          resourceType: 'jira_connection',
          resourceId: cloudResource.id,
          forceEmit: true,
          metadata: { cloud_id: cloudResource.id, site_url: cloudResource.url },
        });
        throw new ConflictException({
          code: 'JIRA_SITE_ALREADY_BOUND',
          message: 'This Jira site is already connected to another organization.',
        });
      }
      throw err;
    }

    let secretRef: string;
    try {
      secretRef = await this.vaultService.storeRefreshToken(tenantId, connection.id, refreshToken);
    } catch (err) {
      await this.repository.updateState(connection.id, 'revoked', actorId);
      throw err;
    }

    const updated = await this.repository.update(
      connection.id,
      { secretRef, state: 'active' },
      actorId,
    );

    await this.auditWriter.append({
      action: 'jira_connection.created',
      resourceType: 'jira_connection',
      resourceId: connection.id,
      forceEmit: true,
      metadata: {
        cloud_id: cloudResource.id,
        site_url: cloudResource.url,
        auth_method: 'oauth3lo',
      },
    });

    this.logger.log({
      operation: 'jira_connection.oauth_complete',
      tenantId,
      connectionId: connection.id,
      cloudId: cloudResource.id,
    });

    return toConnectionResponse(updated ?? connection);
  }

  // ── API token connection ────────────────────────────────────────────────────

  async createApiTokenConnection(dto: CreateApiTokenConnectionDto): Promise<ConnectionResponse> {
    const principal = RequestContextStore.getPrincipal();

    // Derive a synthetic cloud_id for Data Center (site URL slug)
    const cloudId = `dc:${Buffer.from(dto.site_url).toString('base64url')}`;

    await this.assertCloudIdNotBound(cloudId, principal.tenantId, principal.userId);

    let connection: JiraConnection;
    try {
      connection = await this.repository.create({
        tenantId: principal.tenantId,
        siteUrl: dto.site_url,
        cloudId,
        authMethod: 'api_token',
        scopes: [],
        secretRef: 'pending',
        tokenExpiresAt: null,
        state: 'pending',
        createdBy: principal.userId,
      });
    } catch (err) {
      if (isUniqueViolation(err) && isGlobalCloudIdViolation(err)) {
        throw new ConflictException({
          code: 'JIRA_SITE_ALREADY_BOUND',
          message: 'This Jira site is already connected to another organization.',
        });
      }
      throw err;
    }

    const credentialPayload = JSON.stringify({ email: dto.email, api_token: dto.api_token });
    let secretRef: string;
    try {
      secretRef = await this.vaultService.storeRefreshToken(
        principal.tenantId,
        connection.id,
        credentialPayload,
      );
    } catch (err) {
      await this.repository.updateState(connection.id, 'revoked', principal.userId);
      throw err;
    }

    const updated = await this.repository.update(
      connection.id,
      { secretRef, state: 'active' },
      principal.userId,
    );

    await this.auditWriter.append({
      action: 'jira_connection.created',
      resourceType: 'jira_connection',
      resourceId: connection.id,
      forceEmit: true,
      metadata: { site_url: dto.site_url, auth_method: 'api_token' },
    });

    return toConnectionResponse(updated ?? connection);
  }

  // ── List ────────────────────────────────────────────────────────────────────

  async listConnections(query: ListConnectionsQuery): Promise<ListConnectionsResponse> {
    const rows = await this.repository.findAll({
      limit: query.limit + 1,
      cursor: query.cursor,
    });

    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit);
    return {
      data: data.map(toConnectionResponse),
      next_cursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
    };
  }

  // ── Get one ─────────────────────────────────────────────────────────────────

  async getConnection(id: string): Promise<ConnectionResponse> {
    const row = await this.repository.findById(id);
    assertFound(row, 'Jira connection');
    return toConnectionResponse(row!);
  }

  // ── Test ────────────────────────────────────────────────────────────────────

  async testConnection(id: string): Promise<TestConnectionResponse> {
    const principal = RequestContextStore.getPrincipal();
    const row = await this.repository.findById(id);
    assertFound(row, 'Jira connection');
    const conn = row!;

    const start = Date.now();
    let jiraVersion: string | null = null;
    let newState: 'active' | 'degraded' = 'degraded';

    try {
      const accessToken = await this.tokenProvider.getAccessToken(conn.tenantId, conn.id);

      const res = await fetch(`${conn.siteUrl}${JIRA_SERVERINFO_PATH}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        redirect: 'error',
      });

      if (res.ok) {
        const raw = await res.json();
        const info = JiraServerInfoSchema.safeParse(raw);
        jiraVersion = info.success ? info.data.version : null;
        newState = 'active';
      } else if (res.status === 401) {
        await this.tokenProvider.evictCachedToken(conn.tenantId, conn.id);
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      } else {
        throw Object.assign(new Error(`Jira returned ${res.status}`), { status: res.status });
      }
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      newState = 'degraded';

      let code = 'JIRA_PROBE_FAILED';
      let message = 'Failed to probe Jira server. The connection may need re-authorization.';

      if (status === 401 || status === 403) {
        code = status === 403 ? 'JIRA_SCOPE_INSUFFICIENT' : 'JIRA_UNAUTHORIZED';
        message = status === 403
          ? 'Jira scope is insufficient. Re-authorize with required scopes.'
          : 'Jira access token is invalid. Re-authorize the connection.';
      }

      await this.repository.update(id, { state: 'degraded', lastTestedAt: new Date() }, principal.userId);

      throw new UnprocessableEntityException({
        code,
        message,
        latency_ms: Date.now() - start,
      });
    }

    await this.repository.update(id, { state: newState, lastTestedAt: new Date() }, principal.userId);

    return {
      state: newState,
      latency_ms: Date.now() - start,
      jira_version: jiraVersion,
    };
  }

  // ── Revoke ──────────────────────────────────────────────────────────────────

  async revokeConnection(id: string): Promise<void> {
    const principal = RequestContextStore.getPrincipal();
    const row = await this.repository.findById(id);
    assertFound(row, 'Jira connection');
    const conn = row!;

    await this.vaultService.deleteSecret(conn.tenantId, conn.id);
    await this.repository.updateState(conn.id, 'revoked', principal.userId);
    await this.tokenProvider.evictCachedToken(conn.tenantId, conn.id);

    await this.auditWriter.append({
      action: 'jira_connection.revoked',
      resourceType: 'jira_connection',
      resourceId: conn.id,
      forceEmit: true,
      metadata: { cloud_id: conn.cloudId, site_url: conn.siteUrl },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async assertCloudIdNotBound(
    cloudId: string,
    tenantId: string,
    actorId: string,
  ): Promise<void> {
    const existing = await this.repository.findByCloudId(cloudId);
    if (!existing) return;

    if (existing.tenantId !== tenantId) {
      await this.auditWriter.append({
        action: 'jira_connection.cross_tenant_bind_rejected',
        resourceType: 'jira_connection',
        resourceId: cloudId,
        forceEmit: true,
        metadata: { cloud_id: cloudId, bound_tenant_id: existing.tenantId },
      });

      throw new ConflictException({
        code: 'JIRA_SITE_ALREADY_BOUND',
        message: 'This Jira site is already connected to another organization.',
      });
    }

    throw new ConflictException({
      code: 'JIRA_SITE_ALREADY_CONNECTED',
      message: 'This Jira site is already connected to your organization.',
    });
  }
}

function toConnectionResponse(conn: JiraConnection): ConnectionResponse {
  return {
    id: conn.id,
    site_url: conn.siteUrl,
    cloud_id: conn.cloudId,
    auth_method: conn.authMethod,
    scopes: conn.scopes,
    state: conn.state,
    token_expires_at: conn.tokenExpiresAt?.toISOString() ?? null,
    last_tested_at: conn.lastTestedAt?.toISOString() ?? null,
    created_at: conn.createdAt.toISOString(),
    updated_at: conn.updatedAt.toISOString(),
  };
}
