import { z } from 'zod';

// ── Request DTOs ─────────────────────────────────────────────────────────────

export const CreateWebhookEndpointDto = z
  .object({
    url: z.string().url().max(2048),
    description: z.string().max(500).optional(),
    eventTypes: z.array(z.string().min(1).max(100)).min(1).max(50),
  })
  .strict();

export type CreateWebhookEndpointDto = z.infer<typeof CreateWebhookEndpointDto>;

export const UpdateWebhookEndpointDto = z
  .object({
    url: z.string().url().max(2048).optional(),
    description: z.string().max(500).optional(),
    eventTypes: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided.' });

export type UpdateWebhookEndpointDto = z.infer<typeof UpdateWebhookEndpointDto>;

export const ListWebhookEndpointsQuery = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListWebhookEndpointsQuery = z.infer<typeof ListWebhookEndpointsQuery>;

// ── Response shapes ──────────────────────────────────────────────────────────

export interface WebhookEndpointSummary {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  status: string;
  secretKeyVersion: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEndpointCreatedResponse {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  status: string;
  secret: string;
  secretKeyVersion: number;
  createdAt: string;
}

export interface RotateSecretResponse {
  secret: string;
  secretKeyVersion: number;
  previousSecretExpiresAt: string;
}

export interface TestFireResponse {
  httpStatus: number | null;
  latencyMs: number;
  responseSnippet: string | null;
  timedOut: boolean;
}
