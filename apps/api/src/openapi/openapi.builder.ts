/**
 * OpenAPI 3.1 document builder (WO-099).
 *
 * Assembles a valid OpenAPI 3.1 document from:
 *   1. The ROUTES registry (route-registry.ts) — paths, operations, security.
 *   2. Reusable components — error-envelope.ts, pagination.ts, domain schemas.
 *   3. A visibility filter — public vs internal documents.
 *
 * Two documents are produced:
 *   - Full internal document (all routes) — used by tooling and internal dev.
 *   - Public document (public-only routes) — committed snapshot, published to
 *     docs site, consumed by SDK / TypeScript type generation (AC6, AC8).
 *
 * Completeness guard (AC3): buildDocument() throws when any registered route
 * lacks operationId, at least one 2xx response schema, an error envelope
 * reference and a security requirement.  The error message names the exact
 * route so CI output is actionable.
 *
 * Usage:
 *   const doc = buildDocument({ visibility: 'public' });
 *   const json = JSON.stringify(doc, null, 2);
 */

import type { OpenAPIV3_1 } from './types/openapi.types';
import { ROUTES, type RouteEntry } from './route-registry';
import { ERROR_COMPONENT_SCHEMAS } from './components/error-envelope';
import {
  PAGINATION_COMPONENT_SCHEMAS,
  PAGINATION_COMPONENT_PARAMETERS,
} from './components/pagination';

// ---------------------------------------------------------------------------
// Build options
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** 'public' emits only @PublicApi routes; 'internal' emits all routes. */
  visibility: 'public' | 'internal';
  /** Override the routes used (useful in unit tests). */
  routes?: RouteEntry[];
  /** Disable the completeness guard (useful in unit tests for partial specs). */
  skipCompletenessGuard?: boolean;
}

// ---------------------------------------------------------------------------
// Domain component schemas
// ---------------------------------------------------------------------------

const DOMAIN_SCHEMAS: Record<string, OpenAPIV3_1.SchemaObject> = {
  // ── Shared ────────────────────────────────────────────────────────────────

  TicketStatus: {
    type: 'string',
    enum: ['open', 'in_progress', 'resolved', 'closed'],
    description: 'Ticket lifecycle status.',
  },

  TicketPriority: {
    type: 'string',
    enum: ['P1', 'P2', 'P3', 'P4'],
    description: 'SLA priority (P1 = critical, P4 = low).',
  },

  CommentVisibility: {
    type: 'string',
    enum: ['public', 'internal'],
    description: 'Comment visibility (public = visible to customer portal).',
  },

  SlaTimerState: {
    type: 'string',
    enum: ['running', 'paused', 'met', 'breached'],
    description: 'SLA clock state.',
  },

  // ── Ticket ────────────────────────────────────────────────────────────────

  Ticket: {
    type: 'object',
    required: ['id', 'tenantId', 'organizationId', 'subject', 'status', 'priority', 'version', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
      reference: { type: ['string', 'null'], description: 'Human-readable ticket reference e.g. TKT-0001.' },
      subject: { type: 'string', maxLength: 255 },
      description: { type: ['string', 'null'] },
      status: { $ref: '#/components/schemas/TicketStatus' },
      priority: { $ref: '#/components/schemas/TicketPriority' },
      version: { type: 'integer', description: 'Optimistic concurrency version.' },
      assigneeId: { type: ['string', 'null'], format: 'uuid' },
      assignmentGroupId: { type: ['string', 'null'], format: 'uuid' },
      categoryId: { type: ['string', 'null'], format: 'uuid' },
      requesterContactId: { type: ['string', 'null'], format: 'uuid' },
      firstResponseAt: { type: ['string', 'null'], format: 'date-time' },
      resolvedAt: { type: ['string', 'null'], format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  CreateTicketRequest: {
    type: 'object',
    required: ['subject', 'organization_id'],
    properties: {
      subject: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 100000 },
      priority: { $ref: '#/components/schemas/TicketPriority' },
      organization_id: { type: 'string', format: 'uuid' },
      requester_contact_id: { type: 'string', format: 'uuid' },
      category_id: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },

  UpdateTicketRequest: {
    type: 'object',
    properties: {
      subject: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 100000 },
      priority: { $ref: '#/components/schemas/TicketPriority' },
      status: { $ref: '#/components/schemas/TicketStatus' },
      assigneeId: { type: 'string', format: 'uuid' },
      version: { type: 'integer', description: 'Current version for optimistic concurrency.' },
    },
    additionalProperties: false,
  },

  ResolveTicketRequest: {
    type: 'object',
    properties: {
      resolution: { type: 'string', maxLength: 10000 },
      version: { type: 'integer' },
    },
    additionalProperties: false,
  },

  // ── Portal ticket ─────────────────────────────────────────────────────────

  PortalSlaProjection: {
    type: 'object',
    required: ['firstResponseTargetAt', 'resolutionTargetAt', 'state'],
    description: 'Customer-safe SLA projection. Internal thresholds and elapsed times are excluded.',
    properties: {
      firstResponseTargetAt: { type: ['string', 'null'], format: 'date-time' },
      resolutionTargetAt: { type: ['string', 'null'], format: 'date-time' },
      state: { $ref: '#/components/schemas/SlaTimerState' },
    },
  },

  PortalTicketListItem: {
    type: 'object',
    required: ['id', 'subject', 'status', 'priority', 'createdAt', 'updatedAt'],
    description: 'Narrow portal ticket representation for list responses.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      reference: { type: ['string', 'null'] },
      subject: { type: 'string' },
      status: { $ref: '#/components/schemas/TicketStatus' },
      priority: { $ref: '#/components/schemas/TicketPriority' },
      categoryPath: { type: ['string', 'null'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      sla: {
        oneOf: [
          { $ref: '#/components/schemas/PortalSlaProjection' },
          { type: 'null' },
        ],
      },
    },
  },

  PortalStatusHistoryEntry: {
    type: 'object',
    required: ['from', 'to', 'at'],
    properties: {
      from: { type: ['string', 'null'], description: 'Previous status, null for the initial open.' },
      to: { $ref: '#/components/schemas/TicketStatus' },
      at: { type: 'string', format: 'date-time' },
    },
  },

  PortalComment: {
    type: 'object',
    required: ['id', 'body', 'authorDisplayName', 'authorType', 'createdAt'],
    description: 'Public comment on a portal ticket. visibility field is never exposed.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      body: { type: 'string' },
      authorDisplayName: { type: 'string', description: 'Display name. Never email or internal user ID.' },
      authorType: { type: 'string', enum: ['customer', 'agent'] },
      attachments: {
        type: 'array',
        items: { $ref: '#/components/schemas/PortalAttachmentMeta' },
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  PortalTicketDetail: {
    type: 'object',
    required: ['id', 'subject', 'status', 'priority', 'createdAt', 'updatedAt', 'comments', 'statusHistory'],
    description: 'Full portal ticket detail. aiSummary included only when per-tenant setting enables it.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      reference: { type: ['string', 'null'] },
      subject: { type: 'string' },
      status: { $ref: '#/components/schemas/TicketStatus' },
      priority: { $ref: '#/components/schemas/TicketPriority' },
      categoryPath: { type: ['string', 'null'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      sla: {
        oneOf: [{ $ref: '#/components/schemas/PortalSlaProjection' }, { type: 'null' }],
      },
      aiSummary: {
        type: 'string',
        description: 'AI-generated summary. Only present when tenant has enabled portal AI summaries.',
      },
      comments: {
        type: 'array',
        items: { $ref: '#/components/schemas/PortalComment' },
        description: 'Public comments only. Internal agent notes are never returned.',
      },
      statusHistory: {
        type: 'array',
        items: { $ref: '#/components/schemas/PortalStatusHistoryEntry' },
        description: 'Status transitions. actorUserId is never exposed.',
      },
    },
  },

  CreatePortalTicketRequest: {
    type: 'object',
    required: ['subject', 'description'],
    properties: {
      subject: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', minLength: 1, maxLength: 20000 },
      categoryId: { type: 'string', format: 'uuid' },
      requestedPriority: { $ref: '#/components/schemas/TicketPriority' },
      attachmentIds: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        maxItems: 10,
      },
    },
    additionalProperties: false,
  },

  AddPortalCommentRequest: {
    type: 'object',
    required: ['body'],
    description: 'visibility field MUST NOT be present — rejected with 400 if supplied.',
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 20000 },
      attachmentIds: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        maxItems: 10,
      },
    },
    additionalProperties: false,
  },

  // ── Comment ───────────────────────────────────────────────────────────────

  Comment: {
    type: 'object',
    required: ['id', 'ticketId', 'body', 'visibility', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      ticketId: { type: 'string', format: 'uuid' },
      authorId: { type: ['string', 'null'], format: 'uuid' },
      body: { type: 'string' },
      visibility: { $ref: '#/components/schemas/CommentVisibility' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  AddCommentRequest: {
    type: 'object',
    required: ['body', 'visibility'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 20000 },
      visibility: { $ref: '#/components/schemas/CommentVisibility' },
      attachmentIds: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        maxItems: 10,
      },
    },
    additionalProperties: false,
  },

  // ── Attachments ───────────────────────────────────────────────────────────

  AttachmentMeta: {
    type: 'object',
    required: ['id', 'filename', 'mimeType', 'sizeBytes', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      ticketId: { type: 'string', format: 'uuid' },
      filename: { type: 'string' },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  PortalAttachmentMeta: {
    type: 'object',
    required: ['id', 'displayName', 'mimeType', 'sizeBytes'],
    description: 'Customer-safe attachment metadata. s3Key is never exposed.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      displayName: { type: 'string', description: 'Safe filename for display.' },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer' },
    },
  },

  AttachmentDownload: {
    type: 'object',
    required: ['url', 'expiresAt'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Pre-signed S3 GET URL, valid for 5 minutes.' },
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },

  PresignAttachmentRequest: {
    type: 'object',
    required: ['filename', 'mimeType', 'sizeBytes'],
    properties: {
      filename: { type: 'string', maxLength: 255 },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer', minimum: 1, maximum: 26214400, description: 'File size in bytes. Maximum 25 MB.' },
    },
    additionalProperties: false,
  },

  PresignAttachmentResponse: {
    type: 'object',
    required: ['attachmentId', 'uploadUrl', 'fields', 'expiresAt'],
    description: 'Pre-signed S3 POST URL for direct upload. POST the file to uploadUrl as multipart/form-data, including all fields. The API server never receives the file body.',
    properties: {
      attachmentId: { type: 'string', format: 'uuid' },
      uploadUrl: { type: 'string', format: 'uri' },
      fields: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Form fields to include in the S3 POST request.',
      },
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },

  FinalizeAttachmentRequest: {
    type: 'object',
    required: ['attachmentId'],
    properties: {
      attachmentId: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },

  // ── SLA ───────────────────────────────────────────────────────────────────

  SlaClock: {
    type: 'object',
    required: ['clockType', 'state', 'targetAt', 'startedAt', 'elapsedMs', 'remainingMs', 'elapsedPct'],
    properties: {
      clockType: { type: 'string', enum: ['response', 'resolution'] },
      state: { $ref: '#/components/schemas/SlaTimerState' },
      targetAt: { type: 'string', format: 'date-time' },
      startedAt: { type: 'string', format: 'date-time' },
      elapsedMs: { type: 'integer' },
      remainingMs: { type: 'integer' },
      pausedMs: { type: 'integer' },
      elapsedPct: { type: 'number' },
      thresholds: {
        type: 'object',
        properties: {
          first: { type: 'number' },
          second: { type: 'number' },
        },
      },
      computedAt: { type: 'string', format: 'date-time' },
    },
  },

  TicketSlaResult: {
    type: 'object',
    required: ['ticketId', 'clocks'],
    properties: {
      ticketId: { type: 'string', format: 'uuid' },
      clocks: {
        type: 'array',
        items: { $ref: '#/components/schemas/SlaClock' },
      },
      reason: {
        type: 'string',
        enum: ['no_policy', 'timer_not_started'],
        description: 'Present when no SLA timers are active.',
      },
    },
  },

  SlaPolicy: {
    type: 'object',
    required: ['id', 'name', 'priority', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      priority: { $ref: '#/components/schemas/TicketPriority' },
      firstResponseTargetHours: { type: 'number' },
      resolutionTargetHours: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  // ── Organizations ─────────────────────────────────────────────────────────

  Organization: {
    type: 'object',
    required: ['id', 'tenantId', 'name', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      domains: { type: 'array', items: { type: 'string' } },
      customFields: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  CreateOrganizationRequest: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      domains: { type: 'array', items: { type: 'string' }, description: 'Verified email domains.' },
      customFields: { type: 'object', description: 'JSONB custom fields.' },
    },
    additionalProperties: false,
  },

  UpdateOrganizationRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      customFields: { type: 'object' },
    },
    additionalProperties: false,
  },

  // ── Users ─────────────────────────────────────────────────────────────────

  User: {
    type: 'object',
    required: ['id', 'tenantId', 'email', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      displayName: { type: 'string' },
      roles: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  // ── Views ─────────────────────────────────────────────────────────────────

  SavedView: {
    type: 'object',
    required: ['id', 'name', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      filters: { type: 'object', description: 'Filter AST.' },
      isDefault: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  // ── Audit ─────────────────────────────────────────────────────────────────

  AuditLog: {
    type: 'object',
    required: ['id', 'tenantId', 'actorId', 'action', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      actorId: { type: 'string', format: 'uuid' },
      action: { type: 'string' },
      resourceType: { type: 'string' },
      resourceId: { type: 'string', format: 'uuid' },
      changes: { type: 'object' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  // ── Webhooks ──────────────────────────────────────────────────────────────

  Webhook: {
    type: 'object',
    required: ['id', 'tenantId', 'url', 'events', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      url: { type: 'string', format: 'uri' },
      events: { type: 'array', items: { type: 'string' } },
      active: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};

// ---------------------------------------------------------------------------
// Security schemes (AC7)
// ---------------------------------------------------------------------------

const SECURITY_SCHEMES: Record<string, OpenAPIV3_1.SecuritySchemeObject> = {
  /**
   * Staff / agent bearer token — OIDC JWT issued by Okta or Entra ID.
   * Scopes are resolved from JWT `permissions` claim.
   */
  StaffBearer: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'OIDC JWT issued by the tenant identity provider (Okta / Entra ID). ' +
      'Required scopes are noted per operation. Staff and agent principals.',
  },

  /**
   * Portal-scoped bearer token — issued at portal login.
   * Bound to a single organisation; cannot access agent-only endpoints.
   */
  PortalBearer: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Portal-scoped JWT issued at portal login. ' +
      'Bound to a single customer organisation (boundOrganizationId). ' +
      'Cannot authenticate against staff or machine endpoints.',
  },

  /**
   * Machine / API token — long-lived, tenant-issued.
   * Used by integrations and the Jira sync worker.
   */
  MachineToken: {
    type: 'apiKey',
    in: 'header',
    name: 'X-Api-Key',
    description:
      'Long-lived tenant-issued API key for machine-to-machine integrations. ' +
      'Scoped by the permissions assigned at key creation.',
  },
};

// ---------------------------------------------------------------------------
// Tags (AC2)
// ---------------------------------------------------------------------------

const TAG_DEFINITIONS: OpenAPIV3_1.TagObject[] = [
  { name: 'portal-tickets', description: 'Customer portal — ticket read, comment and file operations.' },
  { name: 'portal-attachments', description: 'Customer portal — attachment upload/download.' },
  { name: 'agent-tickets', description: 'Agent workspace — ticket CRUD and lifecycle operations.' },
  { name: 'agent-comments', description: 'Agent workspace — comment management.' },
  { name: 'agent-attachments', description: 'Agent workspace — attachment management.' },
  { name: 'organizations', description: 'Customer organisation management.' },
  { name: 'contacts', description: 'Organisation contact management.' },
  { name: 'users', description: 'User and role management.' },
  { name: 'sla-policies', description: 'SLA policy and calendar management, timer state.' },
  { name: 'sla-calendars', description: 'Business-hours calendar management.' },
  { name: 'views', description: 'Saved ticket-queue filter views.' },
  { name: 'reporting', description: 'Report builder and export operations.' },
  { name: 'audit', description: 'Immutable audit log access.' },
  { name: 'jira', description: 'Jira integration management (internal).' },
  { name: 'notifications', description: 'Notification subscription management.' },
  { name: 'webhooks', description: 'Outbound webhook subscription management.' },
  { name: 'privacy', description: 'Data-subject access and erasure requests.' },
  { name: 'ai', description: 'AI summary and synthesis administration (internal).' },
  { name: 'auth', description: 'Authentication and session management (internal).' },
  { name: 'health', description: 'Service health probes (internal).' },
  { name: 'admin', description: 'Platform-admin tenant management (internal).' },
];

// ---------------------------------------------------------------------------
// Completeness guard (AC3)
// ---------------------------------------------------------------------------

function assertRouteCompleteness(entries: RouteEntry[]): void {
  for (const entry of entries) {
    const op = entry.operation;
    const label = `${entry.method.toUpperCase()} ${entry.path}`;

    if (!op.operationId) {
      throw new Error(`[OpenAPI completeness] ${label} is missing operationId.`);
    }
    if (!op.summary) {
      throw new Error(`[OpenAPI completeness] ${label} (${op.operationId}) is missing summary.`);
    }
    if (!op.tags || op.tags.length === 0) {
      throw new Error(`[OpenAPI completeness] ${label} (${op.operationId}) is missing tags.`);
    }
    if (!op.security) {
      throw new Error(`[OpenAPI completeness] ${label} (${op.operationId}) is missing security requirement.`);
    }

    // Must have at least one 2xx response with a schema
    const success2xx = Object.entries(op.responses).filter(([code]) =>
      code.startsWith('2'),
    );
    if (success2xx.length === 0) {
      throw new Error(
        `[OpenAPI completeness] ${label} (${op.operationId}) has no 2xx response defined.`,
      );
    }

    const hasSchema = success2xx.some(([, resp]) => {
      if (!resp || typeof resp !== 'object') return false;
      const r = resp as OpenAPIV3_1.ResponseObject;
      return !!(r.content?.['application/json']?.schema);
    });
    if (!hasSchema) {
      throw new Error(
        `[OpenAPI completeness] ${label} (${op.operationId}) has no response schema on a 2xx response.`,
      );
    }

    // Public routes must reference the error envelope on at least 400 + 404
    if (entry.visibility === 'public') {
      const codes = Object.keys(op.responses);
      const missingEnvelope = ['400', '401', '404'].filter((c) => !codes.includes(c));
      if (missingEnvelope.length > 0) {
        throw new Error(
          `[OpenAPI completeness] ${label} (${op.operationId}) is missing error responses: ${missingEnvelope.join(', ')}.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Path assembly
// ---------------------------------------------------------------------------

function buildPaths(entries: RouteEntry[]): OpenAPIV3_1.PathsObject {
  const paths: OpenAPIV3_1.PathsObject = {};

  for (const entry of entries) {
    const apiPath = `/api/v1${entry.path}`;
    if (!paths[apiPath]) {
      paths[apiPath] = {};
    }
    (paths[apiPath] as Record<string, OpenAPIV3_1.OperationObject>)[entry.method] =
      entry.operation;
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Public builder function
// ---------------------------------------------------------------------------

/**
 * Builds the OpenAPI 3.1 document.
 *
 * @param opts — visibility filter and optional override routes.
 * @throws when any route entry fails the completeness guard (unless skipCompletenessGuard).
 */
export function buildDocument(opts: BuildOptions): OpenAPIV3_1.Document {
  const sourceRoutes = opts.routes ?? ROUTES;

  const filteredRoutes =
    opts.visibility === 'public'
      ? sourceRoutes.filter((r) => r.visibility === 'public')
      : sourceRoutes;

  if (!opts.skipCompletenessGuard) {
    assertRouteCompleteness(filteredRoutes);
  }

  const paths = buildPaths(filteredRoutes);

  return {
    openapi: '3.1.0',
    info: {
      title: 'OpsNinja API',
      version: '1.0.0',
      description:
        'OpsNinja is a multi-tenant SaaS support and incident-management platform. ' +
        'This document describes the versioned, publicly supported tenant-facing REST surface. ' +
        'Internal endpoints (health, auth, admin, Jira integration) are excluded from this document.',
      contact: {
        name: 'OpsNinja API Support',
        url: 'https://docs.opsninja.io',
        email: 'api-support@opsninja.io',
      },
      license: {
        name: 'Proprietary',
        url: 'https://opsninja.io/terms',
      },
    },
    servers: [
      {
        url: 'https://api.opsninja.io',
        description: 'Production',
      },
      {
        url: 'https://api.staging.opsninja.io',
        description: 'Staging',
      },
      {
        url: 'http://localhost:8080',
        description: 'Local development',
      },
    ],
    tags: TAG_DEFINITIONS,
    security: [{ StaffBearer: [] }],
    paths,
    components: {
      schemas: {
        ...ERROR_COMPONENT_SCHEMAS,
        ...PAGINATION_COMPONENT_SCHEMAS,
        ...DOMAIN_SCHEMAS,
      },
      parameters: {
        ...PAGINATION_COMPONENT_PARAMETERS,
      },
      securitySchemes: SECURITY_SCHEMES,
    },
  };
}

/**
 * Returns the list of public operationIds from the route registry.
 * Used by the completeness guard and contract tests.
 */
export function getPublicOperationIds(routes?: RouteEntry[]): string[] {
  return (routes ?? ROUTES)
    .filter((r) => r.visibility === 'public')
    .map((r) => r.operation.operationId);
}

/**
 * Returns the list of internal operationIds.
 * Used by the exclusion filter test (AC6).
 */
export function getInternalOperationIds(routes?: RouteEntry[]): string[] {
  return (routes ?? ROUTES)
    .filter((r) => r.visibility === 'internal')
    .map((r) => r.operation.operationId);
}
