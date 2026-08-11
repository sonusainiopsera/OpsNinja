/**
 * Error envelope OpenAPI 3.1 schema components (WO-099, AC4).
 *
 * The uniform error envelope is defined ONCE here as a reusable component and
 * referenced by every 4xx/5xx response on every operation via $ref — this
 * ensures changes to the envelope shape propagate automatically to all
 * documented operations and that documentation cannot drift from the
 * runtime shape produced by NestJS exception filters.
 *
 * Shape mirrors the runtime NestJS exception response envelope:
 *   {
 *     error: {
 *       code:    string  — machine-readable error code (e.g. TICKET_CLOSED)
 *       message: string  — human-readable description
 *       details: array   — field-level or context-specific detail items
 *       traceId: string  — correlation ID from X-Trace-ID header (echoed back)
 *     }
 *   }
 *
 * Documented per AC4: 400, 401, 403, 404, 409, 422, 429.
 * 429 includes a Retry-After header per AC4.
 */

import type { OpenAPIV3_1 } from '../types/openapi.types';

// ---------------------------------------------------------------------------
// Component schemas
// ---------------------------------------------------------------------------

/**
 * Single field-level or context-specific error detail item.
 * Used inside the `details` array of ErrorEnvelope.
 */
export const ErrorDetailSchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  additionalProperties: true,
  description: 'Field-level or context detail item.',
  example: { field: 'subject', issue: 'String must contain at least 1 character(s)' },
};

/**
 * The inner error object returned on all error responses.
 */
export const ErrorBodySchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: {
      type: 'string',
      description: 'Machine-readable error code.',
      example: 'VALIDATION_ERROR',
    },
    message: {
      type: 'string',
      description: 'Human-readable error description.',
      example: 'Validation failed',
    },
    details: {
      type: 'array',
      items: { $ref: '#/components/schemas/ErrorDetail' },
      description: 'Field-level or context-specific detail items.',
    },
    traceId: {
      type: 'string',
      description: 'Correlation ID echoed from X-Trace-ID request header.',
      example: '01HV2MXPQ3Y5HRGZTBJE8DKNN4',
    },
  },
};

/**
 * Top-level error envelope wrapping all error responses.
 * Referenced as: $ref: '#/components/schemas/ErrorEnvelope'
 */
export const ErrorEnvelopeSchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { $ref: '#/components/schemas/ErrorBody' },
  },
  example: {
    error: {
      code: 'NOT_FOUND',
      message: 'Ticket not found.',
      details: [],
      traceId: '01HV2MXPQ3Y5HRGZTBJE8DKNN4',
    },
  },
};

// ---------------------------------------------------------------------------
// Reusable response objects keyed by HTTP status code
// ---------------------------------------------------------------------------

/**
 * Returns a standard error response entry for a given HTTP status code.
 * AC4: all 4xx operations reference this.
 */
export function errorResponse(
  statusCode: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
  description: string,
): OpenAPIV3_1.ResponseObject {
  const base: OpenAPIV3_1.ResponseObject = {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorEnvelope' },
      },
    },
  };

  // AC4: 429 must document the Retry-After header
  if (statusCode === 429) {
    base.headers = {
      'Retry-After': {
        description: 'Number of seconds to wait before retrying.',
        schema: { type: 'integer', example: 60 },
      },
    };
  }

  return base;
}

/** Convenience map of all documented error responses. */
export const ERROR_RESPONSES: Record<string, OpenAPIV3_1.ResponseObject> = {
  '400': errorResponse(400, 'Bad Request — validation failed or malformed input.'),
  '401': errorResponse(401, 'Unauthorized — missing or invalid bearer token.'),
  '403': errorResponse(403, 'Forbidden — insufficient permissions.'),
  '404': errorResponse(404, 'Not Found — resource does not exist or is out of scope.'),
  '409': errorResponse(409, 'Conflict — optimistic concurrency version mismatch.'),
  '422': errorResponse(422, 'Unprocessable Entity — business rule violation.'),
  '429': errorResponse(429, 'Too Many Requests — rate limit exceeded.'),
};

/** Component schemas to merge into the document's components.schemas section. */
export const ERROR_COMPONENT_SCHEMAS: Record<string, OpenAPIV3_1.SchemaObject> = {
  ErrorDetail: ErrorDetailSchema,
  ErrorBody: ErrorBodySchema,
  ErrorEnvelope: ErrorEnvelopeSchema,
};
