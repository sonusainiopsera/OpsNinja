/**
 * Cursor-pagination OpenAPI 3.1 components (WO-099, AC5).
 *
 * All list operations in the OpsNinja API use opaque cursor-based pagination
 * with the following contract:
 *   - `cursor`  — base64url-encoded opaque continuation token (optional)
 *   - `limit`   — page size, integer 1–100, default 20
 *
 * List responses include:
 *   - `items` (or `data`) — the result array for that page
 *   - `nextCursor`        — null when no further pages exist
 *
 * Shared components defined here are referenced via $ref across every list
 * operation to ensure consistent documentation and a single place to update
 * the pagination contract if it changes.
 */

import type { OpenAPIV3_1 } from '../types/openapi.types';

// ---------------------------------------------------------------------------
// Reusable parameter components — AC5
// ---------------------------------------------------------------------------

/**
 * Cursor query parameter: opaque continuation token.
 * AC5: documented consistently across all list operations.
 */
export const CursorParam: OpenAPIV3_1.ParameterObject = {
  name: 'cursor',
  in: 'query',
  required: false,
  description:
    'Opaque base64url-encoded continuation token returned as `nextCursor` in the prior page response. ' +
    'Omit to start from the first page.',
  schema: {
    type: 'string',
    example: 'eyJpZCI6IjAxSFYyTVhQUTNZNUhSR1pUQkpFOERLTk40IiwiY3JlYXRlZEF0IjoiMjAyNi0wMS0xNVQxMDowMDowMFoifQ',
  },
};

/**
 * Limit query parameter: page size, maximum 100.
 * AC5: maximum 100 enforced via maximum constraint.
 */
export const LimitParam: OpenAPIV3_1.ParameterObject = {
  name: 'limit',
  in: 'query',
  required: false,
  description: 'Number of items to return per page. Maximum 100.',
  schema: {
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  },
};

// ---------------------------------------------------------------------------
// Reusable schema components — AC5
// ---------------------------------------------------------------------------

/**
 * CursorPage wrapper schema for list responses.
 * Individual operations use allOf + properties to declare their item type.
 *
 * Response shape:
 *   { data: T[], nextCursor: string | null, traceId: string }
 *
 * AC5: traceId is documented consistently across all list operations.
 */
export const CursorPageSchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  required: ['data', 'nextCursor'],
  properties: {
    data: {
      type: 'array',
      description: 'Items on this page.',
      items: {},
    },
    nextCursor: {
      type: ['string', 'null'],
      description: 'Continuation token to fetch the next page. Null when no further pages exist.',
      example: 'eyJpZCI6IjAxSFYyTVhQUTNZNUhSR1pUQkpFOERLTk40IiwiY3JlYXRlZEF0IjoiMjAyNi0wMS0xNVQxMDowMDowMFoifQ',
    },
    traceId: {
      type: 'string',
      description: 'Correlation ID echoed from X-Trace-ID request header.',
      example: '01HV2MXPQ3Y5HRGZTBJE8DKNN4',
    },
  },
};

/** TraceId field schema included in all success responses. */
export const TraceIdSchema: OpenAPIV3_1.SchemaObject = {
  type: 'string',
  description: 'Correlation ID echoed from X-Trace-ID request header.',
  example: '01HV2MXPQ3Y5HRGZTBJE8DKNN4',
};

// ---------------------------------------------------------------------------
// Helper — builds a typed page response schema for a given item $ref
// ---------------------------------------------------------------------------

/**
 * Builds a CursorPage schema whose `data` array items reference the given
 * item schema $ref.  Used to construct list-response schemas inline.
 *
 * @param itemRef — JSON Pointer reference, e.g. '#/components/schemas/PortalTicketListItem'
 */
export function cursorPageOf(itemRef: string): OpenAPIV3_1.SchemaObject {
  return {
    type: 'object',
    required: ['data', 'nextCursor'],
    properties: {
      data: {
        type: 'array',
        items: { $ref: itemRef },
        description: 'Items on this page.',
      },
      nextCursor: {
        type: ['string', 'null'],
        description: 'Continuation token. Null when no further pages exist.',
        example: null,
      },
    },
  };
}

/** Component schemas to merge into the document's components.schemas section. */
export const PAGINATION_COMPONENT_SCHEMAS: Record<string, OpenAPIV3_1.SchemaObject> = {
  CursorPage: CursorPageSchema,
  TraceId: TraceIdSchema,
};

/** Component parameters to merge into the document's components.parameters section. */
export const PAGINATION_COMPONENT_PARAMETERS: Record<string, OpenAPIV3_1.ParameterObject> = {
  CursorParam,
  LimitParam,
};
