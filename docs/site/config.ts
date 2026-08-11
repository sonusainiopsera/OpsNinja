/**
 * Developer portal site configuration.
 *
 * Describes the static documentation site built from:
 *  1. The committed public OpenAPI document (apps/api/openapi.json)
 *  2. Authored guide pages (docs/site/guides/*.md)
 *  3. Generated webhook catalogue (docs/site/webhooks/*)
 *
 * The build pipeline reads this config to:
 *  - Locate the OpenAPI spec to render reference pages
 *  - Discover guide pages and validate front-matter
 *  - Set the versioned output path for CI artifact upload
 *  - Apply redaction scan deny-lists over built output
 */

export interface PortalConfig {
  /** Human-readable site title. */
  title: string;
  /** API version string, read from the OpenAPI spec's info.version field. */
  apiVersion: string;
  /** Path to the committed public OpenAPI document, relative to the repo root. */
  openapiSpecPath: string;
  /** Directory containing authored guide markdown files. */
  guidesDir: string;
  /** Output directory for the built site (gitignored). */
  outputDir: string;
  /** Required front-matter fields that every guide page must declare. */
  requiredFrontMatter: readonly string[];
  /** Deny-list patterns for the redaction scanner. */
  redactionDenyList: readonly RedactionPattern[];
  /** Webhook delivery configuration for the catalogue generator. */
  webhookDelivery: WebhookDeliveryConfig;
}

export interface RedactionPattern {
  name: string;
  pattern: RegExp;
  description: string;
}

export interface WebhookDeliveryConfig {
  /** Maximum delivery attempts before DLQ routing. */
  maxAttempts: number;
  /** Per-attempt backoff delays in seconds. */
  backoffDelaysSeconds: readonly number[];
  /** Signature replay window in seconds. */
  signatureReplayWindowSeconds: number;
  /** Consumer response timeout in seconds. */
  consumerTimeoutSeconds: number;
}

import {
  MAX_WEBHOOK_DELIVERY_ATTEMPTS,
  WEBHOOK_BACKOFF_DELAYS_SECONDS,
  SIGNATURE_REPLAY_WINDOW_SECONDS,
  WEBHOOK_CONSUMER_TIMEOUT_SECONDS,
} from '../../packages/events/src/delivery-config';

export const PORTAL_CONFIG: PortalConfig = {
  title: 'OpsNinja Developer Portal',
  apiVersion: 'v1',
  openapiSpecPath: 'apps/api/openapi.json',
  guidesDir: 'docs/site/guides',
  outputDir: 'docs/dist',
  requiredFrontMatter: ['title', 'audience', 'last-reviewed'],
  redactionDenyList: [
    {
      name: 'real_opsninja_domain',
      pattern: /\bapp\.opsninja\.io\b|\bportal\.opsninja\.io\b|\bapi\.opsninja\.io\b/gi,
      description: 'Production OpsNinja hostnames must not appear in documentation output.',
    },
    {
      name: 'internal_hostname',
      pattern: /\binternal\.[a-z0-9-]+\.local\b|\bcluster\.local\b|\b10\.\d+\.\d+\.\d+\b/gi,
      description: 'Internal hostnames and RFC1918 addresses must not appear in documentation.',
    },
    {
      name: 'bearer_token_shaped',
      pattern: /\bey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
      description: 'JWT-shaped token strings must not appear in documentation output.',
    },
    {
      name: 'aws_access_key',
      pattern: /\b(AKIA|ASIA|AROA|AIDA)[A-Z2-7]{16}\b/g,
      description: 'AWS access key prefixes must not appear in documentation output.',
    },
    {
      name: 'hex_secret_shaped',
      pattern: /\b[0-9a-f]{64}\b/g,
      description: 'Hex strings of 64 chars (potential HMAC secrets/tokens) must not appear.',
    },
    {
      name: 'real_uuid_tenant',
      // Block well-known synthetic tenant patterns that are NOT the documented placeholder UUIDs
      // Placeholder UUIDs follow the 00000000-0000-0000 or 01910f2a-0000-7000 patterns.
      // This pattern blocks UUID-shaped strings in unexpected formats used in real data.
      pattern: /tenant_id["']?\s*:\s*["'][0-9a-f]{8}-(?!0000)[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-(?!000000000)[0-9a-f]{12}["']/gi,
      description: 'Non-synthetic tenant ID values must not appear in documentation examples.',
    },
  ],
  webhookDelivery: {
    maxAttempts: MAX_WEBHOOK_DELIVERY_ATTEMPTS,
    backoffDelaysSeconds: WEBHOOK_BACKOFF_DELAYS_SECONDS,
    signatureReplayWindowSeconds: SIGNATURE_REPLAY_WINDOW_SECONDS,
    consumerTimeoutSeconds: WEBHOOK_CONSUMER_TIMEOUT_SECONDS,
  },
};
