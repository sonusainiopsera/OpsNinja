import { z } from 'zod';

// ── Shared ────────────────────────────────────────────────────────────────────

const JIRA_SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'] as const;

// ── OAuth start ───────────────────────────────────────────────────────────────

export const StartOAuthSchema = z.object({
  redirect_uri: z.string().url(),
  scopes: z.array(z.string()).optional(),
}).strict();

export type StartOAuthDto = z.infer<typeof StartOAuthSchema>;

export interface StartOAuthResponse {
  authorization_url: string;
  state: string;
  expires_at: string;
}

// ── OAuth callback ────────────────────────────────────────────────────────────

export const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
}).strict();

export type OAuthCallbackQuery = z.infer<typeof OAuthCallbackQuerySchema>;

// ── API token connection ──────────────────────────────────────────────────────

export const CreateApiTokenConnectionSchema = z.object({
  site_url: z.string().url(),
  email: z.string().email(),
  api_token: z.string().min(1),
}).strict();

export type CreateApiTokenConnectionDto = z.infer<typeof CreateApiTokenConnectionSchema>;

// ── List query ────────────────────────────────────────────────────────────────

export const ListConnectionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().uuid().optional(),
}).strict();

export type ListConnectionsQuery = z.infer<typeof ListConnectionsQuerySchema>;

// ── Connection response ───────────────────────────────────────────────────────

export interface ConnectionResponse {
  id: string;
  site_url: string;
  cloud_id: string;
  auth_method: 'oauth3lo' | 'api_token';
  scopes: string[];
  state: 'pending' | 'active' | 'degraded' | 'revoked';
  token_expires_at: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListConnectionsResponse {
  data: ConnectionResponse[];
  next_cursor: string | null;
}

// ── Test response ─────────────────────────────────────────────────────────────

export interface TestConnectionResponse {
  state: 'active' | 'degraded';
  latency_ms: number;
  jira_version: string | null;
}

// ── Atlassian token response (strict parse for exchange) ─────────────────────

export const AtlassianTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string().optional(),
});

export type AtlassianTokenResponse = z.infer<typeof AtlassianTokenResponseSchema>;

// ── Atlassian cloud info ──────────────────────────────────────────────────────

export const AtlassianCloudResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  scopes: z.array(z.string()),
});

export const AtlassianCloudResourcesSchema = z.array(AtlassianCloudResourceSchema);
export type AtlassianCloudResource = z.infer<typeof AtlassianCloudResourceSchema>;

// ── Jira server info ──────────────────────────────────────────────────────────

export const JiraServerInfoSchema = z.object({
  version: z.string(),
  versionNumbers: z.array(z.number()).optional(),
  deploymentType: z.string().optional(),
}).passthrough();

export type JiraServerInfo = z.infer<typeof JiraServerInfoSchema>;
