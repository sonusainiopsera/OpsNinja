/**
 * JiraMetadataService — discovery of Jira projects, issue types and fields.
 *
 * All Jira API calls are cached in Redis for 15 minutes per (tenant, connection, resource)
 * to protect the per-tenant rate budget. A force-refresh query param bypasses the cache.
 *
 * Cache keys:
 *   jira:meta:{tenantId}:{connectionId}:projects
 *   jira:meta:{tenantId}:{connectionId}:issuetypes:{projectKey}
 *   jira:meta:{tenantId}:{connectionId}:fields:{projectKey}:{issueTypeId}
 */

import { Injectable, Inject, UnprocessableEntityException, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import { JiraHttpClient } from '../http/jira-http.client';
import { JiraTokenProvider } from '../tokens/jira-token.provider';
import { JiraConnectionsRepository } from '../connections/jira-connections.repository';

const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  issueTypes: JiraIssueTypeSummary[];
}

export interface JiraIssueTypeSummary {
  id: string;
  name: string;
  description?: string;
  subtask: boolean;
}

export interface JiraFieldSchema {
  fieldId: string;
  name: string;
  schemaType: string;
  required: boolean;
  allowedValues: Array<{ id: string; name: string; value?: string }>;
}

export interface JiraProjectsResult {
  projects: JiraProject[];
  nextCursor: string | null;
  cachedAt: string;
  stale?: boolean;
}

// ---------------------------------------------------------------------------
// Raw Jira API types
// ---------------------------------------------------------------------------

interface RawJiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  issueTypes?: Array<{ id: string; name: string; description?: string; subtask: boolean }>;
}

interface RawCreateMeta {
  projects: Array<{
    id: string;
    key: string;
    issuetypes: Array<{
      id: string;
      name: string;
      fields: Record<string, {
        required: boolean;
        schema: { type: string; system?: string };
        name: string;
        allowedValues?: Array<{ id: string; name: string; value?: string }>;
      }>;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class JiraMetadataService {
  private readonly logger = new Logger(JiraMetadataService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly http: JiraHttpClient,
    private readonly tokenProvider: JiraTokenProvider,
    @Inject('JIRA_CONNECTIONS_REPOSITORY') private readonly connRepo: JiraConnectionsRepository,
  ) {}

  // --------------------------------------------------------------------------
  // Projects
  // --------------------------------------------------------------------------

  async getProjects(
    tenantId: string,
    connectionId: string,
    opts: { forceRefresh?: boolean; cursor?: string; limit?: number } = {},
  ): Promise<JiraProjectsResult> {
    const cacheKey = `jira:meta:${tenantId}:${connectionId}:projects`;
    const limit = opts.limit ?? 50;

    if (!opts.forceRefresh) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as JiraProjectsResult;
        // Apply cursor pagination on cached data
        return this.applyProjectsCursor(parsed, opts.cursor, limit);
      }
    }

    const conn = await this.connRepo.findById(tenantId, connectionId);
    if (!conn) {
      throw new UnprocessableEntityException({
        error: { code: 'CONNECTION_NOT_FOUND', message: 'Jira connection not found.' },
      });
    }

    const accessToken = await this.tokenProvider.getAccessToken(tenantId, connectionId);
    const siteUrl = conn.siteUrl.replace(/\/$/, '');

    let projects: JiraProject[];
    try {
      const raw = await this.fetchProjects(siteUrl, accessToken);
      projects = raw;
    } catch (err) {
      // Degrade to stale cache if available
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as JiraProjectsResult;
        this.logger.warn('Jira projects fetch failed; serving stale cache', { connectionId });
        return { ...this.applyProjectsCursor(parsed, opts.cursor, limit), stale: true };
      }
      // Check if it's a permissions issue
      if ((err as { status?: number }).status === 403) {
        throw new UnprocessableEntityException({
          error: {
            code: 'JIRA_BROWSE_PERMISSION_MISSING',
            message: 'The Jira OAuth scope lacks browse permission. Re-consent required.',
          },
        });
      }
      throw err;
    }

    const result: JiraProjectsResult = { projects, nextCursor: null, cachedAt: new Date().toISOString() };
    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
    return this.applyProjectsCursor(result, opts.cursor, limit);
  }

  // --------------------------------------------------------------------------
  // Issue types for a project
  // --------------------------------------------------------------------------

  async getIssueTypes(
    tenantId: string,
    connectionId: string,
    projectKey: string,
    forceRefresh = false,
  ): Promise<JiraIssueTypeSummary[]> {
    const cacheKey = `jira:meta:${tenantId}:${connectionId}:issuetypes:${projectKey}`;

    if (!forceRefresh) {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as JiraIssueTypeSummary[];
    }

    const conn = await this.connRepo.findById(tenantId, connectionId);
    if (!conn) {
      throw new UnprocessableEntityException({
        error: { code: 'CONNECTION_NOT_FOUND', message: 'Jira connection not found.' },
      });
    }

    const accessToken = await this.tokenProvider.getAccessToken(tenantId, connectionId);
    const siteUrl = conn.siteUrl.replace(/\/$/, '');
    const issueTypes = await this.fetchIssueTypes(siteUrl, accessToken, projectKey);

    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(issueTypes));
    return issueTypes;
  }

  // --------------------------------------------------------------------------
  // Fields for a project + issue type
  // --------------------------------------------------------------------------

  async getFields(
    tenantId: string,
    connectionId: string,
    projectKey: string,
    issueTypeId: string,
    forceRefresh = false,
  ): Promise<JiraFieldSchema[]> {
    const cacheKey = `jira:meta:${tenantId}:${connectionId}:fields:${projectKey}:${issueTypeId}`;

    if (!forceRefresh) {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as JiraFieldSchema[];
    }

    const conn = await this.connRepo.findById(tenantId, connectionId);
    if (!conn) {
      throw new UnprocessableEntityException({
        error: { code: 'CONNECTION_NOT_FOUND', message: 'Jira connection not found.' },
      });
    }

    const accessToken = await this.tokenProvider.getAccessToken(tenantId, connectionId);
    const siteUrl = conn.siteUrl.replace(/\/$/, '');
    const fields = await this.fetchFields(siteUrl, accessToken, projectKey, issueTypeId);

    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(fields));
    return fields;
  }

  // --------------------------------------------------------------------------
  // Required-field validation helper
  // --------------------------------------------------------------------------

  /**
   * Returns field IDs that are required by Jira for the given issue type
   * but are not covered by any entry in fieldMap.
   */
  async getMissingRequiredFields(
    tenantId: string,
    connectionId: string,
    projectKey: string,
    issueTypeId: string,
    fieldMapTargetIds: string[],
  ): Promise<string[]> {
    const fields = await this.getFields(tenantId, connectionId, projectKey, issueTypeId);
    const covered = new Set(fieldMapTargetIds);
    // 'summary' (ticket.title) is always required; other required fields must be mapped
    return fields
      .filter((f) => f.required && !covered.has(f.fieldId))
      .map((f) => f.fieldId);
  }

  // --------------------------------------------------------------------------
  // Private: Jira API calls
  // --------------------------------------------------------------------------

  private async fetchProjects(siteUrl: string, accessToken: string): Promise<JiraProject[]> {
    const url = `${siteUrl}/rest/api/3/project/search?expand=issueTypes&maxResults=100`;
    const data = await this.http.getJson<{ values?: RawJiraProject[] } | RawJiraProject[]>(url, accessToken);

    const projects = (data as { values?: RawJiraProject[] }).values ?? (data as RawJiraProject[]);
    return projects.map((p: RawJiraProject) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      projectTypeKey: p.projectTypeKey,
      issueTypes: (p.issueTypes ?? []).map((it) => ({
        id: it.id,
        name: it.name,
        description: it.description,
        subtask: it.subtask,
      })),
    }));
  }

  private async fetchIssueTypes(
    siteUrl: string,
    accessToken: string,
    projectKey: string,
  ): Promise<JiraIssueTypeSummary[]> {
    // Use createmeta endpoint for compatibility with older Jira versions
    const url = `${siteUrl}/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=issuetypes`;
    const data = await this.http.getJson<RawCreateMeta>(url, accessToken);

    const project = data.projects?.[0];
    if (!project) return [];
    return (project.issuetypes ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      subtask: false,
    }));
  }

  private async fetchFields(
    siteUrl: string,
    accessToken: string,
    projectKey: string,
    issueTypeId: string,
  ): Promise<JiraFieldSchema[]> {
    const url = `${siteUrl}/rest/api/3/issue/createmeta?projectKeys=${projectKey}&issuetypeIds=${issueTypeId}&expand=projects.issuetypes.fields`;
    const data = await this.http.getJson<RawCreateMeta>(url, accessToken);

    const project = data.projects?.[0];
    const issueType = project?.issuetypes?.[0];
    if (!issueType) return [];

    const fields: JiraFieldSchema[] = [];
    for (const [fieldId, meta] of Object.entries(issueType.fields)) {
      // Truncate at 200 fields per the documented cap
      if (fields.length >= 200) break;
      fields.push({
        fieldId,
        name: meta.name,
        schemaType: meta.schema?.type ?? 'string',
        required: meta.required,
        allowedValues: (meta.allowedValues ?? []).slice(0, 50),
      });
    }
    return fields;
  }

  // --------------------------------------------------------------------------
  // Cursor pagination helper (applied to cached project list)
  // --------------------------------------------------------------------------

  private applyProjectsCursor(
    result: JiraProjectsResult,
    cursor: string | undefined,
    limit: number,
  ): JiraProjectsResult {
    const all = result.projects;
    const startIdx = cursor
      ? all.findIndex((p) => p.id === cursor) + 1
      : 0;
    const page = all.slice(startIdx, startIdx + limit);
    const nextCursor = startIdx + limit < all.length ? page[page.length - 1]?.id ?? null : null;
    return { ...result, projects: page, nextCursor };
  }
}
