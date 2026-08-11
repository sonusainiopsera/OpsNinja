/**
 * Webhook endpoint DTOs — strict Zod schemas rejecting unknown properties.
 */

import { z } from 'zod';

export const CreateWebhookEndpointSchema = z.object({
  url: z.string().url().max(2048),
  description: z.string().max(500).optional(),
  eventTypes: z.array(z.string().min(1).max(200)).min(1, 'At least one event type is required'),
}).strict();

export type CreateWebhookEndpointDto = z.infer<typeof CreateWebhookEndpointSchema>;

export const UpdateWebhookEndpointSchema = z.object({
  url: z.string().url().max(2048).optional(),
  description: z.string().max(500).optional(),
  eventTypes: z.array(z.string().min(1).max(200)).min(1).optional(),
}).strict();

export type UpdateWebhookEndpointDto = z.infer<typeof UpdateWebhookEndpointSchema>;

/** Safe read response — never includes any secret field. */
export interface WebhookEndpointResponse {
  id: string;
  url: string;
  description?: string | null;
  eventTypes: string[];
  status: string;
  lastSuccessAt?: string | null;
  consecutiveFailures: number;
  secretKeyVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Creation response — only ever includes the plaintext secret once. */
export interface WebhookEndpointCreatedResponse extends WebhookEndpointResponse {
  /** RESTRICTED: shown exactly once, never returned by GET endpoints. */
  secret: string;
}

export interface RotateSecretResponse {
  /** RESTRICTED: shown exactly once. */
  secret: string;
  secretKeyVersion: number;
  previousSecretExpiresAt: string;
}

export interface TestFireResponse {
  httpStatus: number;
  latencyMs: number;
  responseSnippet: string;
}
