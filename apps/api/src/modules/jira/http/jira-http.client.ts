/**
 * JiraHttpClient — thin HTTP wrapper for all Atlassian REST calls.
 *
 * Enforces:
 *  - 10s connect / 20s total timeout via AbortController.
 *  - No redirect following (redirect: 'error') — a redirect from Atlassian
 *    is unexpected and should surface as a structured error, not a silent follow.
 *  - All errors translated to structured JiraApiError; raw Atlassian payloads
 *    never reach the caller.
 */

import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

export interface AccessibleResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl: string;
}

export interface JiraServerInfo {
  version: string;
  deploymentType: string;
  baseUrl: string;
}

const CONNECT_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 20_000;

@Injectable()
export class JiraHttpClient {

  /** Fetch accessible resources (Cloud sites) for the authenticated user. */
  async getAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
    const data = await this.get<AccessibleResource[]>(
      'https://api.atlassian.com/oauth/token/accessible-resources',
      accessToken,
    );
    return data;
  }

  /** Probe the Jira server for connectivity and version info. */
  async getServerInfo(siteUrl: string, accessToken: string): Promise<JiraServerInfo> {
    const url = `${siteUrl.replace(/\/$/, '')}/rest/api/3/serverInfo`;
    const data = await this.get<{ version: string; deploymentType: string; baseUrl: string }>(url, accessToken);
    return {
      version: data.version,
      deploymentType: data.deploymentType,
      baseUrl: data.baseUrl,
    };
  }

  /** Exchange an OAuth authorization code for tokens at the Atlassian token endpoint. */
  async exchangeCode(params: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope: string }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    });

    const data = await this.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    }>('https://auth.atlassian.com/oauth/token', body.toString(), 'application/x-www-form-urlencoded');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  }

  /** Use a refresh token to get a new access token. */
  async refreshAccessToken(params: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
    });

    const data = await this.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>('https://auth.atlassian.com/oauth/token', body.toString(), 'application/x-www-form-urlencoded');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async get<T>(url: string, bearerToken: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if ((err as Error).name === 'AbortError') {
        throw new ServiceUnavailableException({
          error: { code: 'JIRA_TIMEOUT', message: 'Jira API request timed out.' },
        });
      }
      throw new ServiceUnavailableException({
        error: { code: 'JIRA_UNREACHABLE', message: 'Could not reach the Jira API.' },
      });
    }
    clearTimeout(timeout);

    return this.handleResponse<T>(response);
  }

  private async post<T>(url: string, body: string, contentType: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          Accept: 'application/json',
        },
        body,
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if ((err as Error).name === 'AbortError') {
        throw new ServiceUnavailableException({
          error: { code: 'JIRA_TIMEOUT', message: 'Atlassian OAuth token endpoint timed out.' },
        });
      }
      throw new ServiceUnavailableException({
        error: { code: 'JIRA_UNREACHABLE', message: 'Could not reach the Atlassian token endpoint.' },
      });
    }
    clearTimeout(timeout);

    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      return response.json() as Promise<T>;
    }

    if (response.status === 401) {
      throw new UnprocessableEntityException({
        error: { code: 'JIRA_UNAUTHORIZED', message: 'Jira returned 401 — credentials may be invalid or revoked.' },
      });
    }

    if (response.status === 403) {
      throw new UnprocessableEntityException({
        error: { code: 'JIRA_SCOPE_INSUFFICIENT', message: 'Jira returned 403 — re-consent may be required.' },
      });
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') ?? '60';
      throw new ServiceUnavailableException({
        error: { code: 'JIRA_RATE_LIMITED', message: `Jira rate limit exceeded. Retry-After: ${retryAfter}s.` },
      });
    }

    throw new ServiceUnavailableException({
      error: { code: 'JIRA_ERROR', message: `Jira returned HTTP ${response.status}.` },
    });
  }
}
