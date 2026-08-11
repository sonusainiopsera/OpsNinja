/**
 * JiraOperationsService — thin wrapper for outbound Jira REST API calls.
 *
 * Operations:
 *   createIssue   POST /rest/api/3/issue
 *   addComment    POST /rest/api/3/issue/{key}/comment
 *   transition    POST /rest/api/3/issue/{key}/transitions (resolves id first)
 *   updateFields  PUT  /rest/api/3/issue/{key}
 *
 * Timeouts: 10s connect / 20s read (consistent with the shared HTTP client).
 * No retry logic here — retry lives in OutboundHandler.
 * Throws JiraApiError on any non-2xx response; callers must catch and classify.
 */

import { Injectable, Logger } from '@nestjs/common';
import { classifyJiraError } from './error-classifier';
import type { JiraErrorClassification } from './error-classifier';

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS    = 20_000;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class JiraApiError extends Error {
  constructor(
    public readonly classification: JiraErrorClassification,
    public readonly httpStatus: number | null,
    public readonly responseBody: string,
    /** Raw Retry-After header value for 429 responses. */
    public readonly retryAfterHeader: string | null = null,
  ) {
    super(`Jira API error [${classification.code}]: ${classification.message}`);
    this.name = 'JiraApiError';
  }
}

// ---------------------------------------------------------------------------
// Response types (minimal — only fields the worker needs)
// ---------------------------------------------------------------------------

export interface JiraCreatedIssue {
  id: string;
  key: string;
  self: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; statusCategory: { key: string } };
}

export interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class JiraOperationsService {
  private readonly logger = new Logger(JiraOperationsService.name);

  // --------------------------------------------------------------------------
  // createIssue
  // --------------------------------------------------------------------------

  async createIssue(
    siteUrl: string,
    accessToken: string,
    fields: Record<string, unknown>,
  ): Promise<JiraCreatedIssue> {
    const url = `${siteUrl.replace(/\/$/, '')}/rest/api/3/issue`;
    const body = { fields };

    this.logger.debug('Jira createIssue', { url, project: fields['project'] });
    return this.postJson<JiraCreatedIssue>(url, accessToken, body);
  }

  // --------------------------------------------------------------------------
  // addComment
  // --------------------------------------------------------------------------

  async addComment(
    siteUrl: string,
    accessToken: string,
    issueKey: string,
    commentBody: unknown,
  ): Promise<void> {
    const url = `${siteUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}/comment`;
    await this.postJson(url, accessToken, { body: commentBody });
  }

  // --------------------------------------------------------------------------
  // transition
  // --------------------------------------------------------------------------

  /**
   * Resolve the transition id by name, then execute the transition.
   * Throws JiraApiError(JIRA_WORKFLOW_TRANSITION_INVALID) when the transition
   * name is not found in the issue's available transitions.
   */
  async transition(
    siteUrl: string,
    accessToken: string,
    issueKey: string,
    transitionName: string,
  ): Promise<void> {
    const transitionsUrl = `${siteUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}/transitions`;
    const available = await this.getJson<JiraTransitionsResponse>(transitionsUrl, accessToken);

    const match = available.transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase(),
    );

    if (!match) {
      throw new JiraApiError(
        {
          kind: 'permanent',
          code: 'JIRA_WORKFLOW_TRANSITION_INVALID',
          message: `Transition '${transitionName}' is not available for issue ${issueKey}. Available: ${available.transitions.map((t) => t.name).join(', ')}`,
        },
        null,
        '',
      );
    }

    await this.postJson(transitionsUrl, accessToken, { transition: { id: match.id } });
  }

  // --------------------------------------------------------------------------
  // updateFields
  // --------------------------------------------------------------------------

  async updateFields(
    siteUrl: string,
    accessToken: string,
    issueKey: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const url = `${siteUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}`;
    await this.putJson(url, accessToken, { fields });
  }

  // --------------------------------------------------------------------------
  // HTTP helpers
  // --------------------------------------------------------------------------

  private async postJson<T>(url: string, accessToken: string, body: unknown): Promise<T> {
    return this.request<T>('POST', url, accessToken, JSON.stringify(body));
  }

  private async putJson<T>(url: string, accessToken: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', url, accessToken, JSON.stringify(body));
  }

  private async getJson<T>(url: string, accessToken: string): Promise<T> {
    return this.request<T>('GET', url, accessToken, null);
  }

  private async request<T>(
    method: string,
    url: string,
    accessToken: string,
    body: string | null,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = method === 'GET' ? READ_TIMEOUT_MS : CONNECT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ?? undefined,
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      const classification = classifyJiraError(null, null);
      throw new JiraApiError(classification, null, '', null);
    }
    clearTimeout(timeout);

    // 204 No Content — success with no body
    if (response.status === 204) return undefined as unknown as T;

    const responseText = await response.text().catch(() => '');
    const retryAfter = response.headers.get('Retry-After');

    if (!response.ok) {
      let errorBody: Record<string, unknown> | null = null;
      try { errorBody = JSON.parse(responseText); } catch { /* ignore */ }
      const classification = classifyJiraError(response.status, retryAfter, errorBody);
      throw new JiraApiError(classification, response.status, responseText, retryAfter);
    }

    try {
      return JSON.parse(responseText) as T;
    } catch {
      return undefined as unknown as T;
    }
  }
}
