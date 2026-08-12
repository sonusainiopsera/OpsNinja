/**
 * Route registry — central manifest of all OpsNinja API operations (WO-099).
 *
 * Each entry declares:
 *   - method, path, operationId, summary, tags, visibility
 *   - security requirements (maps to principal type)
 *   - request body / query parameter references
 *   - all documented response codes with schema $refs
 *
 * This file is the single source of truth for the OpenAPI document.  The
 * generation script reads it via openapi.builder.ts, which applies the
 * visibility filter and emits public vs internal documents.
 *
 * Completeness guard (AC3): the build fails if any entry lacks
 * operationId, at least one 2xx response schema, an error envelope reference
 * and a security requirement.
 */

import type { OpenAPIV3_1 } from './types/openapi.types';
import { ERROR_RESPONSES } from './components/error-envelope';
import { cursorPageOf } from './components/pagination';

// ---------------------------------------------------------------------------
// Security schemes (AC7) — references to components.securitySchemes
// ---------------------------------------------------------------------------

/** Staff / agent bearer token (OIDC-issued JWT from Okta / Entra ID). */
export const STAFF_SECURITY: OpenAPIV3_1.SecurityRequirementObject[] = [
  { StaffBearer: [] },
];

/** Portal-scoped bearer token (issued at portal login). */
export const PORTAL_SECURITY: OpenAPIV3_1.SecurityRequirementObject[] = [
  { PortalBearer: [] },
];

/** Machine / API token (long-lived tenant-issued token). */
export const MACHINE_SECURITY: OpenAPIV3_1.SecurityRequirementObject[] = [
  { MachineToken: [] },
];

/** Internal: health / no authentication required. */
export const NO_SECURITY: OpenAPIV3_1.SecurityRequirementObject[] = [];

// ---------------------------------------------------------------------------
// Cursor-list shared parameters
// ---------------------------------------------------------------------------

const CURSOR_PARAMS: OpenAPIV3_1.ReferenceObject[] = [
  { $ref: '#/components/parameters/CursorParam' },
  { $ref: '#/components/parameters/LimitParam' },
];

// ---------------------------------------------------------------------------
// Common response sets
// ---------------------------------------------------------------------------

/** Standard error responses referenced on every authenticated operation. */
const STD_ERRORS = {
  '400': ERROR_RESPONSES['400'],
  '401': ERROR_RESPONSES['401'],
  '403': ERROR_RESPONSES['403'],
  '404': ERROR_RESPONSES['404'],
  '429': ERROR_RESPONSES['429'],
};

const STD_ERRORS_WITH_CONFLICT = {
  ...STD_ERRORS,
  '409': ERROR_RESPONSES['409'],
  '422': ERROR_RESPONSES['422'],
};

// ---------------------------------------------------------------------------
// Registered route entries
// ---------------------------------------------------------------------------

export interface RouteEntry {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Path with leading slash, using {param} syntax. */
  path: string;
  visibility: 'public' | 'internal';
  operation: OpenAPIV3_1.OperationObject;
}

export const ROUTES: RouteEntry[] = [
  // =========================================================================
  // HEALTH (internal — load balancer probe, no compatibility obligation)
  // =========================================================================
  {
    method: 'get',
    path: '/health',
    visibility: 'internal',
    operation: {
      operationId: 'healthCheck',
      summary: 'Load-balancer health probe',
      tags: ['health'],
      security: NO_SECURITY,
      'x-internal-reason': 'Load-balancer probe — no tenant-facing compatibility obligation.',
      responses: {
        '200': {
          description: 'Service is healthy.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status', 'timestamp'],
                properties: {
                  status: { type: 'string', example: 'ok' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        '503': { description: 'Service unavailable — replica lag too high.' },
      },
    },
  },

  // =========================================================================
  // PORTAL — TICKETS (public)
  // =========================================================================
  {
    method: 'get',
    path: '/portal/tickets',
    visibility: 'public',
    operation: {
      operationId: 'listPortalTickets',
      summary: 'List portal tickets with cursor pagination',
      tags: ['portal-tickets'],
      security: PORTAL_SECURITY,
      parameters: [
        ...CURSOR_PARAMS,
        {
          name: 'status',
          in: 'query',
          required: false,
          description: 'Filter by ticket status.',
          schema: {
            type: 'string',
            enum: ['open', 'in_progress', 'resolved', 'closed'],
          },
        },
        {
          name: 'q',
          in: 'query',
          required: false,
          description: 'Full-text search term (max 200 characters).',
          schema: { type: 'string', maxLength: 200 },
        },
      ],
      responses: {
        '200': {
          description: 'Paginated list of tickets belonging to the caller\'s organisation.',
          content: {
            'application/json': {
              schema: cursorPageOf('#/components/schemas/PortalTicketListItem'),
              example: {
                data: [
                  {
                    id: 'aa000000-0000-0003-0000-000000000001',
                    reference: 'TKT-0001',
                    subject: 'Login issue on mobile app',
                    status: 'open',
                    priority: 'P2',
                    categoryPath: null,
                    createdAt: '2026-01-15T10:00:00Z',
                    updatedAt: '2026-01-15T10:00:00Z',
                    sla: {
                      firstResponseTargetAt: '2026-01-15T14:00:00Z',
                      resolutionTargetAt: '2026-01-17T10:00:00Z',
                      state: 'running',
                    },
                  },
                ],
                nextCursor: null,
              },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'post',
    path: '/portal/tickets',
    visibility: 'public',
    operation: {
      operationId: 'createPortalTicket',
      summary: 'Submit a new support request from the portal',
      tags: ['portal-tickets'],
      security: PORTAL_SECURITY,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreatePortalTicketRequest' },
            example: {
              subject: 'Login issue on mobile app',
              description: 'Cannot login after updating the app to v4.2.1.',
              requestedPriority: 'P2',
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Ticket created successfully.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'traceId'],
                properties: {
                  data: { $ref: '#/components/schemas/PortalTicketDetail' },
                  traceId: { $ref: '#/components/schemas/TraceId' },
                },
              },
            },
          },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },

  {
    method: 'get',
    path: '/portal/tickets/{id}',
    visibility: 'public',
    operation: {
      operationId: 'getPortalTicket',
      summary: 'Get portal ticket detail with public comments and SLA projection',
      tags: ['portal-tickets'],
      security: PORTAL_SECURITY,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Ticket UUID.',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Ticket detail with public comments, SLA projection and status history.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PortalTicketDetail' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'post',
    path: '/portal/tickets/{id}/comments',
    visibility: 'public',
    operation: {
      operationId: 'addPortalComment',
      summary: 'Add a public comment to a portal ticket',
      description:
        'Visibility is always forced to `public`. Supplying a `visibility` field returns 400. ' +
        'Replies to closed tickets return 422 TICKET_CLOSED unless the tenant policy permits re-open.',
      tags: ['portal-tickets'],
      security: PORTAL_SECURITY,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Ticket UUID.',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AddPortalCommentRequest' },
            example: { body: 'I tried restarting — still broken.' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Comment added successfully.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PortalComment' },
            },
          },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },

  // =========================================================================
  // PORTAL — ATTACHMENTS (public)
  // =========================================================================
  {
    method: 'get',
    path: '/portal/attachments/{id}/download',
    visibility: 'public',
    operation: {
      operationId: 'downloadPortalAttachment',
      summary: 'Get a pre-signed download URL for a portal attachment',
      tags: ['portal-attachments'],
      security: PORTAL_SECURITY,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Attachment UUID.',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Pre-signed download URL valid for 5 minutes.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AttachmentDownload' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'post',
    path: '/portal/attachments/presign',
    visibility: 'public',
    operation: {
      operationId: 'presignPortalAttachment',
      summary: 'Obtain a pre-signed S3 POST URL for portal attachment upload',
      description:
        'Returns a pre-signed S3 POST URL and form fields. ' +
        'The client POSTs the file directly to S3 (multipart/form-data), ' +
        'then calls the confirm endpoint. The OpsNinja API never receives the file body.',
      tags: ['portal-attachments'],
      security: PORTAL_SECURITY,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PresignAttachmentRequest' },
            example: { filename: 'screenshot.png', mimeType: 'image/png', sizeBytes: 204800 },
          },
        },
      },
      responses: {
        '201': {
          description: 'Pre-signed upload URL and attachment record.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PresignAttachmentResponse' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'post',
    path: '/portal/attachments/{id}/confirm',
    visibility: 'public',
    operation: {
      operationId: 'confirmPortalAttachment',
      summary: 'Mark a portal attachment upload as complete',
      tags: ['portal-attachments'],
      security: PORTAL_SECURITY,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Attachment UUID returned by the presign endpoint.',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Attachment confirmed and ready to be linked to a ticket.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PortalAttachmentMeta' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // AGENT — TICKETS (public)
  // =========================================================================
  {
    method: 'post',
    path: '/tickets',
    visibility: 'public',
    operation: {
      operationId: 'createTicket',
      summary: 'Create a new ticket (agent)',
      tags: ['agent-tickets'],
      security: STAFF_SECURITY,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateTicketRequest' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Ticket created.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'traceId'],
                properties: {
                  data: { $ref: '#/components/schemas/Ticket' },
                  traceId: { $ref: '#/components/schemas/TraceId' },
                },
              },
            },
          },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },

  {
    method: 'get',
    path: '/tickets',
    visibility: 'public',
    operation: {
      operationId: 'listTickets',
      summary: 'List / queue tickets with saved-view filtering and cursor pagination',
      tags: ['agent-tickets'],
      security: STAFF_SECURITY,
      parameters: [
        ...CURSOR_PARAMS,
        {
          name: 'viewId',
          in: 'query',
          required: false,
          description: 'UUID of a saved view to apply as filter preset.',
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: {
            type: 'string',
            enum: ['open', 'in_progress', 'resolved', 'closed'],
          },
        },
      ],
      responses: {
        '200': {
          description: 'Paginated ticket list.',
          content: {
            'application/json': {
              schema: cursorPageOf('#/components/schemas/Ticket'),
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'get',
    path: '/tickets/{id}',
    visibility: 'public',
    operation: {
      operationId: 'getTicket',
      summary: 'Get a ticket by ID',
      tags: ['agent-tickets'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': {
          description: 'Ticket detail.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: { data: { $ref: '#/components/schemas/Ticket' } },
              },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'patch',
    path: '/tickets/{id}',
    visibility: 'public',
    operation: {
      operationId: 'updateTicket',
      summary: 'Update ticket fields (partial update)',
      description:
        'Optimistic concurrency: include the current `version` from a prior GET in the ' +
        '`If-Match` header or `version` body field. Returns 409 on stale version.',
      tags: ['agent-tickets'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateTicketRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Ticket updated.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: { data: { $ref: '#/components/schemas/Ticket' } },
              },
            },
          },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },

  {
    method: 'post',
    path: '/tickets/{id}/resolve',
    visibility: 'public',
    operation: {
      operationId: 'resolveTicket',
      summary: 'Resolve a ticket',
      tags: ['agent-tickets'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ResolveTicketRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Ticket resolved.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: { data: { $ref: '#/components/schemas/Ticket' } },
              },
            },
          },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },

  // =========================================================================
  // AGENT — COMMENTS (public)
  // =========================================================================
  {
    method: 'post',
    path: '/tickets/{id}/comments',
    visibility: 'public',
    operation: {
      operationId: 'addComment',
      summary: 'Add a comment to a ticket',
      tags: ['agent-comments'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AddCommentRequest' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Comment added.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Comment' },
            },
          },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },

  {
    method: 'get',
    path: '/tickets/{id}/comments',
    visibility: 'public',
    operation: {
      operationId: 'listComments',
      summary: 'List comments on a ticket',
      tags: ['agent-comments'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ...CURSOR_PARAMS,
      ],
      responses: {
        '200': {
          description: 'Paginated comment list.',
          content: {
            'application/json': {
              schema: cursorPageOf('#/components/schemas/Comment'),
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // AGENT — ATTACHMENTS (public)
  // =========================================================================
  {
    method: 'post',
    path: '/tickets/{id}/attachments/presign',
    visibility: 'public',
    operation: {
      operationId: 'presignAttachment',
      summary: 'Obtain a pre-signed S3 POST URL for an agent attachment upload',
      description:
        'Returns a pre-signed URL and form fields for direct S3 upload. ' +
        'The API server never receives the file body (AC: file upload contract).',
      tags: ['agent-attachments'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PresignAttachmentRequest' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Pre-signed upload URL.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PresignAttachmentResponse' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'post',
    path: '/tickets/{id}/attachments/finalize',
    visibility: 'public',
    operation: {
      operationId: 'finalizeAttachment',
      summary: 'Finalize an agent attachment after S3 upload',
      tags: ['agent-attachments'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/FinalizeAttachmentRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Attachment finalized.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AttachmentMeta' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'get',
    path: '/attachments/{id}/download',
    visibility: 'public',
    operation: {
      operationId: 'downloadAttachment',
      summary: 'Get a pre-signed download URL for an agent attachment',
      tags: ['agent-attachments'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': {
          description: 'Pre-signed download URL valid for 5 minutes.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AttachmentDownload' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // SLA (public)
  // =========================================================================
  {
    method: 'get',
    path: '/tickets/{id}/sla',
    visibility: 'public',
    operation: {
      operationId: 'getTicketSla',
      summary: 'Get SLA timer state for a ticket',
      tags: ['sla-policies'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': {
          description: 'SLA timer state including all active clocks.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TicketSlaResult' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'get',
    path: '/sla/policies',
    visibility: 'public',
    operation: {
      operationId: 'listSlaPolicies',
      summary: 'List SLA policies for the tenant',
      tags: ['sla-policies'],
      security: STAFF_SECURITY,
      parameters: CURSOR_PARAMS as OpenAPIV3_1.ParameterObject[],
      responses: {
        '200': {
          description: 'Paginated SLA policy list.',
          content: {
            'application/json': {
              schema: cursorPageOf('#/components/schemas/SlaPolicy'),
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // ORGANIZATIONS (public)
  // =========================================================================
  {
    method: 'post',
    path: '/organizations',
    visibility: 'public',
    operation: {
      operationId: 'createOrganization',
      summary: 'Create a customer organisation',
      tags: ['organizations'],
      security: STAFF_SECURITY,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateOrganizationRequest' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Organisation created.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Organization' },
            },
          },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },

  {
    method: 'get',
    path: '/organizations/{id}',
    visibility: 'public',
    operation: {
      operationId: 'getOrganization',
      summary: 'Get a customer organisation by ID',
      tags: ['organizations'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': {
          description: 'Organisation detail.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Organization' },
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  {
    method: 'patch',
    path: '/organizations/{id}',
    visibility: 'public',
    operation: {
      operationId: 'updateOrganization',
      summary: 'Update an organisation',
      tags: ['organizations'],
      security: STAFF_SECURITY,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateOrganizationRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Organisation updated.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Organization' },
            },
          },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },

  // =========================================================================
  // AUTH (internal — exchange credentials, not part of public REST surface)
  // =========================================================================
  {
    method: 'post',
    path: '/auth/login',
    visibility: 'internal',
    operation: {
      operationId: 'authLogin',
      summary: 'Exchange OIDC credentials for a session',
      tags: ['auth'],
      security: NO_SECURITY,
      'x-internal-reason':
        'Authentication flow — not part of the versioned tenant-facing REST surface.',
      responses: {
        '200': {
          description: 'Session established.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { accessToken: { type: 'string' }, expiresIn: { type: 'integer' } },
              },
            },
          },
        },
        '401': ERROR_RESPONSES['401'],
      },
    },
  },

  // =========================================================================
  // VIEWS (public)
  // =========================================================================
  {
    method: 'get',
    path: '/views',
    visibility: 'public',
    operation: {
      operationId: 'listViews',
      summary: 'List saved views for the authenticated user',
      tags: ['views'],
      security: STAFF_SECURITY,
      parameters: CURSOR_PARAMS as OpenAPIV3_1.ParameterObject[],
      responses: {
        '200': {
          description: 'Paginated saved-view list.',
          content: {
            'application/json': {
              schema: cursorPageOf('#/components/schemas/SavedView'),
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // USERS (public)
  // =========================================================================
  {
    method: 'get',
    path: '/users',
    visibility: 'public',
    operation: {
      operationId: 'listUsers',
      summary: 'List users in the tenant',
      tags: ['users'],
      security: STAFF_SECURITY,
      parameters: CURSOR_PARAMS as OpenAPIV3_1.ParameterObject[],
      responses: {
        '200': {
          description: 'Paginated user list.',
          content: {
            'application/json': {
              schema: cursorPageOf('#/components/schemas/User'),
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // AUDIT (public)
  // =========================================================================
  {
    method: 'get',
    path: '/audit/logs',
    visibility: 'public',
    operation: {
      operationId: 'listAuditLogs',
      summary: 'List immutable audit log entries',
      tags: ['audit'],
      security: STAFF_SECURITY,
      parameters: CURSOR_PARAMS as OpenAPIV3_1.ParameterObject[],
      responses: {
        '200': {
          description: 'Paginated audit log entries.',
          content: {
            'application/json': {
              schema: cursorPageOf('#/components/schemas/AuditLog'),
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // JIRA (internal — integration plumbing, not public API surface)
  // =========================================================================
  {
    method: 'get',
    path: '/jira/connections',
    visibility: 'internal',
    operation: {
      operationId: 'listJiraConnections',
      summary: 'List Jira connections for the tenant',
      tags: ['jira'],
      security: STAFF_SECURITY,
      'x-internal-reason':
        'Jira integration admin operations — excluded from public docs to avoid unintended compatibility obligations on integration plumbing.',
      responses: {
        '200': {
          description: 'Jira connection list.',
          content: { 'application/json': { schema: { type: 'array', items: {} } } },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // WEBHOOKS (public)
  // =========================================================================
  {
    method: 'get',
    path: '/webhooks',
    visibility: 'public',
    operation: {
      operationId: 'listWebhooks',
      summary: 'List outbound webhook subscriptions',
      tags: ['webhooks'],
      security: STAFF_SECURITY,
      parameters: CURSOR_PARAMS as OpenAPIV3_1.ParameterObject[],
      responses: {
        '200': {
          description: 'Paginated webhook list.',
          content: {
            'application/json': {
              schema: cursorPageOf('#/components/schemas/Webhook'),
            },
          },
        },
        ...STD_ERRORS,
      },
    },
  },

  // =========================================================================
  // ADMIN (internal — tenant management, excludes from public surface)
  // =========================================================================
  {
    method: 'post',
    path: '/admin/tenants',
    visibility: 'internal',
    operation: {
      operationId: 'adminCreateTenant',
      summary: 'Create a new tenant (admin only)',
      tags: ['admin'],
      security: STAFF_SECURITY,
      'x-internal-reason':
        'Platform-admin operation — publishing this would create an unintended compatibility obligation and widen the attack surface.',
      responses: {
        '201': {
          description: 'Tenant created.',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        ...STD_ERRORS_WITH_CONFLICT,
      },
    },
  },
];
