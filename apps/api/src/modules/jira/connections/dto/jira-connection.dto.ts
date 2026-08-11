/**
 * Zod DTOs for Jira connection endpoints — WO-051.
 *
 * All schemas use .strict() to reject unknown properties.
 * Token and credential fields are input-only; they never appear in responses.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// OAuth start
// ---------------------------------------------------------------------------

export const OAuthStartSchema = z.object({
  /** Optional override for the redirect URI. Defaults to server-configured value. */
  redirectUri: z.string().url().optional(),
}).strict();

export type OAuthStartDto = z.infer<typeof OAuthStartSchema>;

// ---------------------------------------------------------------------------
// OAuth callback (query params)
// ---------------------------------------------------------------------------

export const OAuthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().uuid(),
}).strict();

export type OAuthCallbackDto = z.infer<typeof OAuthCallbackSchema>;

// ---------------------------------------------------------------------------
// Create with API token (Data Center)
// ---------------------------------------------------------------------------

export const CreateApiTokenConnectionSchema = z.object({
  siteUrl: z.string().url(),
  email: z.string().email(),
  apiToken: z.string().min(1),
}).strict();

export type CreateApiTokenConnectionDto = z.infer<typeof CreateApiTokenConnectionSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const ListConnectionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
}).strict();

export type ListConnectionsQueryDto = z.infer<typeof ListConnectionsQuerySchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface JiraConnectionResponse {
  id: string;
  siteUrl: string;
  cloudId: string | null;
  authMethod: string;
  scopes: string[];
  state: string;
  tokenExpiresAt: string | null;
  lastTestedAt: string | null;
}

export interface OAuthStartResponse {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

export interface TestConnectionResponse {
  state: string;
  latencyMs: number;
  jiraVersion: string;
}

export interface PaginatedConnectionsResponse {
  data: JiraConnectionResponse[];
  nextCursor: string | null;
}
