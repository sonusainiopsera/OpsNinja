/**
 * Unit tests for the OpenAPI builder and related helpers (WO-099, AC10).
 *
 * Covers:
 *   1. Route classification annotation reader (visibility.decorator.ts)
 *   2. Schema-to-OpenAPI conversion helpers (components/*.ts)
 *   3. Internal-route exclusion filter (buildDocument with visibility:'public')
 *   4. Completeness guard behaviour
 *   5. Public document structure invariants
 *
 * These tests run in pure Node.js without NestJS bootstrapping.
 */

import 'reflect-metadata';
import {
  PublicApi,
  InternalApi,
  readVisibility,
  readOperationMeta,
  API_VISIBILITY_KEY,
  API_OPERATION_KEY,
} from './visibility.decorator';
import { buildDocument, getPublicOperationIds, getInternalOperationIds } from './openapi.builder';
import { errorResponse, ERROR_COMPONENT_SCHEMAS } from './components/error-envelope';
import {
  CursorParam,
  LimitParam,
  cursorPageOf,
  PAGINATION_COMPONENT_PARAMETERS,
} from './components/pagination';
import { ROUTES } from './route-registry';
import type { RouteEntry } from './route-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoute(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return {
    method: 'get',
    path: '/test',
    visibility: 'public',
    operation: {
      operationId: 'testOp',
      summary: 'Test operation',
      tags: ['agent-tickets'],
      security: [{ StaffBearer: [] }],
      responses: {
        '200': {
          description: 'OK',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        '400': { description: 'Bad Request' },
        '401': { description: 'Unauthorized' },
        '404': { description: 'Not Found' },
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC10a: Visibility decorator — annotation reader
// ---------------------------------------------------------------------------

describe('visibility.decorator — annotation reader', () => {
  it('stores public visibility metadata on a method', () => {
    class TestController {
      @PublicApi({ operationId: 'myOp', summary: 'My Op', tags: ['agent-tickets'] })
      myMethod() { return; }
    }

    const target = TestController.prototype;
    const visibility = readVisibility(target, 'myMethod');
    expect(visibility).toBe('public');
  });

  it('stores internal visibility metadata on a method', () => {
    class TestController {
      @InternalApi({
        operationId: 'internalOp',
        summary: 'Internal Op',
        tags: ['health'],
        internalReason: 'Load balancer probe.',
      })
      internalMethod() { return; }
    }

    const target = TestController.prototype;
    const visibility = readVisibility(target, 'internalMethod');
    expect(visibility).toBe('internal');
  });

  it('returns undefined for unannotated methods', () => {
    class TestController {
      unannotatedMethod() { return; }
    }

    const target = TestController.prototype;
    const visibility = readVisibility(target, 'unannotatedMethod');
    expect(visibility).toBeUndefined();
  });

  it('stores full operation metadata via @PublicApi', () => {
    class TestController {
      @PublicApi({ operationId: 'op1', summary: 'Op 1', tags: ['agent-tickets'] })
      method1() { return; }
    }

    const target = TestController.prototype;
    const meta = readOperationMeta(target, 'method1');
    expect(meta).toMatchObject({
      operationId: 'op1',
      summary: 'Op 1',
      tags: ['agent-tickets'],
    });
  });

  it('stores internalReason via @InternalApi', () => {
    class TestController {
      @InternalApi({
        operationId: 'op2',
        summary: 'Op 2',
        tags: ['admin'],
        internalReason: 'Admin plumbing.',
      })
      method2() { return; }
    }

    const target = TestController.prototype;
    const meta = readOperationMeta(target, 'method2');
    expect(meta?.internalReason).toBe('Admin plumbing.');
  });

  it('uses the correct reflect-metadata keys', () => {
    expect(API_VISIBILITY_KEY).toBe('openapi:visibility');
    expect(API_OPERATION_KEY).toBe('openapi:operation');
  });
});

// ---------------------------------------------------------------------------
// AC10b: Schema-to-OpenAPI conversion helpers — error envelope
// ---------------------------------------------------------------------------

describe('error-envelope component', () => {
  it('defines ErrorEnvelope with required error field', () => {
    const schema = ERROR_COMPONENT_SCHEMAS['ErrorEnvelope'];
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('error');
  });

  it('defines ErrorBody with required code and message', () => {
    const schema = ERROR_COMPONENT_SCHEMAS['ErrorBody'];
    expect(schema.required).toContain('code');
    expect(schema.required).toContain('message');
  });

  it('errorResponse() produces correct description', () => {
    const resp = errorResponse(404, 'Not Found');
    expect(resp.description).toBe('Not Found');
    expect(resp.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ErrorEnvelope',
    });
  });

  it('errorResponse(429) includes Retry-After header', () => {
    const resp = errorResponse(429, 'Too Many Requests');
    expect(resp.headers?.['Retry-After']).toBeDefined();
    const header = resp.headers!['Retry-After'] as { schema: { type: string } };
    expect(header.schema?.type).toBe('integer');
  });

  it('errorResponse for non-429 does NOT include Retry-After', () => {
    const resp = errorResponse(400, 'Bad Request');
    expect(resp.headers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC10b: Schema-to-OpenAPI conversion helpers — pagination
// ---------------------------------------------------------------------------

describe('pagination component', () => {
  it('CursorParam is a query parameter named "cursor"', () => {
    expect(CursorParam.name).toBe('cursor');
    expect(CursorParam.in).toBe('query');
    expect(CursorParam.required).toBe(false);
  });

  it('LimitParam has maximum 100 (AC5)', () => {
    expect(LimitParam.name).toBe('limit');
    expect(LimitParam.in).toBe('query');
    const schema = LimitParam.schema as { maximum: number; minimum: number; default: number };
    expect(schema.maximum).toBe(100);
    expect(schema.minimum).toBe(1);
    expect(schema.default).toBe(20);
  });

  it('cursorPageOf() builds a page schema with the given item $ref', () => {
    const schema = cursorPageOf('#/components/schemas/Ticket');
    expect(schema.type).toBe('object');
    expect((schema.properties?.['data'] as { items: { $ref: string } }).items.$ref).toBe(
      '#/components/schemas/Ticket',
    );
    expect(schema.required).toContain('data');
    expect(schema.required).toContain('nextCursor');
  });

  it('PAGINATION_COMPONENT_PARAMETERS includes CursorParam and LimitParam', () => {
    expect(PAGINATION_COMPONENT_PARAMETERS['CursorParam']).toBe(CursorParam);
    expect(PAGINATION_COMPONENT_PARAMETERS['LimitParam']).toBe(LimitParam);
  });
});

// ---------------------------------------------------------------------------
// AC10c: Internal-route exclusion filter
// ---------------------------------------------------------------------------

describe('buildDocument — internal-route exclusion filter (AC6)', () => {
  it('public document contains only public routes', () => {
    const doc = buildDocument({ visibility: 'public', skipCompletenessGuard: true });
    const paths = Object.keys(doc.paths);

    const internalPaths = ROUTES.filter((r) => r.visibility === 'internal').map(
      (r) => `/api/v1${r.path}`,
    );

    for (const internalPath of internalPaths) {
      expect(paths).not.toContain(internalPath);
    }
  });

  it('internal document contains ALL routes including internal', () => {
    const doc = buildDocument({ visibility: 'internal', skipCompletenessGuard: true });
    const paths = Object.keys(doc.paths);

    const internalPaths = ROUTES.filter((r) => r.visibility === 'internal').map(
      (r) => `/api/v1${r.path}`,
    );

    for (const internalPath of internalPaths) {
      expect(paths).toContain(internalPath);
    }
  });

  it('known internal operationIds are NOT in the public document', () => {
    const doc = buildDocument({ visibility: 'public', skipCompletenessGuard: true });
    const allOps = Object.values(doc.paths).flatMap((pi) =>
      ['get', 'post', 'put', 'patch', 'delete'].flatMap((m) => {
        const op = (pi as Record<string, { operationId?: string }>)[m];
        return op?.operationId ? [op.operationId] : [];
      }),
    );

    const internalIds = getInternalOperationIds();
    for (const id of internalIds) {
      expect(allOps).not.toContain(id);
    }
  });

  it('getPublicOperationIds() matches routes in the public document', () => {
    const doc = buildDocument({ visibility: 'public', skipCompletenessGuard: true });
    const docOps = Object.values(doc.paths).flatMap((pi) =>
      ['get', 'post', 'put', 'patch', 'delete'].flatMap((m) => {
        const op = (pi as Record<string, { operationId?: string }>)[m];
        return op?.operationId ? [op.operationId] : [];
      }),
    );

    const registryPublicIds = getPublicOperationIds();
    for (const id of registryPublicIds) {
      expect(docOps).toContain(id);
    }
  });

  it('filters can be applied to a custom route list', () => {
    const routes: RouteEntry[] = [
      makeRoute({ visibility: 'public', operation: { ...makeRoute().operation, operationId: 'pub1' } }),
      makeRoute({
        path: '/internal',
        visibility: 'internal',
        operation: { ...makeRoute().operation, operationId: 'int1' },
      }),
    ];

    const doc = buildDocument({ visibility: 'public', routes, skipCompletenessGuard: true });
    const ops = Object.values(doc.paths).flatMap((pi) =>
      ['get', 'post'].flatMap((m) => {
        const op = (pi as Record<string, { operationId?: string }>)[m];
        return op?.operationId ? [op.operationId] : [];
      }),
    );

    expect(ops).toContain('pub1');
    expect(ops).not.toContain('int1');
  });
});

// ---------------------------------------------------------------------------
// Completeness guard (AC3)
// ---------------------------------------------------------------------------

describe('buildDocument — completeness guard', () => {
  it('throws when operationId is missing', () => {
    const route = makeRoute({
      operation: { ...makeRoute().operation, operationId: '' },
    });
    expect(() =>
      buildDocument({ visibility: 'public', routes: [route] }),
    ).toThrow('[OpenAPI completeness]');
  });

  it('throws when summary is missing', () => {
    const route = makeRoute({
      operation: { ...makeRoute().operation, summary: '' },
    });
    expect(() =>
      buildDocument({ visibility: 'public', routes: [route] }),
    ).toThrow('[OpenAPI completeness]');
  });

  it('throws when no 2xx response is defined', () => {
    const route = makeRoute({
      operation: {
        ...makeRoute().operation,
        responses: {
          '400': { description: 'Bad Request' },
        },
      },
    });
    expect(() =>
      buildDocument({ visibility: 'public', routes: [route] }),
    ).toThrow('no 2xx response defined');
  });

  it('throws when 2xx response has no schema', () => {
    const route = makeRoute({
      operation: {
        ...makeRoute().operation,
        responses: {
          '200': { description: 'OK' },
          '400': { description: 'Bad Request' },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Not Found' },
        },
      },
    });
    expect(() =>
      buildDocument({ visibility: 'public', routes: [route] }),
    ).toThrow('no response schema');
  });

  it('skipCompletenessGuard bypasses validation', () => {
    const route = makeRoute({
      operation: { ...makeRoute().operation, operationId: '' },
    });
    expect(() =>
      buildDocument({ visibility: 'public', routes: [route], skipCompletenessGuard: true }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Public document structure invariants (AC1, AC2, AC4, AC5, AC7)
// ---------------------------------------------------------------------------

describe('buildDocument — public document invariants', () => {
  let publicDoc: ReturnType<typeof buildDocument>;

  beforeAll(() => {
    publicDoc = buildDocument({ visibility: 'public' });
  });

  it('has openapi version 3.1.0 (AC1)', () => {
    expect(publicDoc.openapi).toBe('3.1.0');
  });

  it('has info with title and version', () => {
    expect(publicDoc.info.title).toBe('OpsNinja API');
    expect(publicDoc.info.version).toBeTruthy();
  });

  it('has all three security schemes (AC7)', () => {
    expect(publicDoc.components?.securitySchemes?.['StaffBearer']).toBeDefined();
    expect(publicDoc.components?.securitySchemes?.['PortalBearer']).toBeDefined();
    expect(publicDoc.components?.securitySchemes?.['MachineToken']).toBeDefined();
  });

  it('has ErrorEnvelope component schema (AC4)', () => {
    expect(publicDoc.components?.schemas?.['ErrorEnvelope']).toBeDefined();
  });

  it('has CursorParam and LimitParam (AC5)', () => {
    expect(publicDoc.components?.parameters?.['CursorParam']).toBeDefined();
    expect(publicDoc.components?.parameters?.['LimitParam']).toBeDefined();
    const limit = publicDoc.components?.parameters?.['LimitParam'] as { schema: { maximum: number } };
    expect(limit.schema?.maximum).toBe(100);
  });

  it('all paths start with /api/v1', () => {
    for (const p of Object.keys(publicDoc.paths)) {
      expect(p).toMatch(/^\/api\/v1/);
    }
  });

  it('every operation has operationId (AC2)', () => {
    for (const [path, pathItem] of Object.entries(publicDoc.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const op = (pathItem as Record<string, { operationId?: string }>)[method];
        if (op) {
          expect(op.operationId).toBeTruthy();
        }
      }
    }
  });

  it('every operation has summary (AC2)', () => {
    for (const [path, pathItem] of Object.entries(publicDoc.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const op = (pathItem as Record<string, { summary?: string }>)[method];
        if (op) {
          expect(op.summary).toBeTruthy();
        }
      }
    }
  });

  it('every operation has security requirement (AC2, AC7)', () => {
    for (const [path, pathItem] of Object.entries(publicDoc.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const op = (pathItem as Record<string, { security?: unknown[] }>)[method];
        if (op) {
          expect(Array.isArray(op.security)).toBe(true);
          expect((op.security as unknown[]).length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('portal-tickets operations use PortalBearer (AC7)', () => {
    for (const pathItem of Object.values(publicDoc.paths)) {
      for (const method of ['get', 'post'] as const) {
        const op = (pathItem as Record<string, { tags?: string[]; security?: Array<Record<string, string[]>> }>)[method];
        if (op?.tags?.includes('portal-tickets') || op?.tags?.includes('portal-attachments')) {
          const hasPortalSecurity = op.security?.some((s) => 'PortalBearer' in s);
          expect(hasPortalSecurity).toBe(true);
        }
      }
    }
  });

  it('document has multiple servers including production (AC1)', () => {
    expect(publicDoc.servers?.some((s) => s.url.includes('opsninja.io'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Route registry completeness
// ---------------------------------------------------------------------------

describe('route-registry', () => {
  it('has no duplicate operationIds', () => {
    const ids = ROUTES.map((r) => r.operation.operationId);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it('all routes have a defined visibility', () => {
    for (const r of ROUTES) {
      expect(['public', 'internal']).toContain(r.visibility);
    }
  });

  it('internal routes have x-internal-reason set', () => {
    const internalRoutes = ROUTES.filter((r) => r.visibility === 'internal');
    for (const r of internalRoutes) {
      expect(r.operation['x-internal-reason']).toBeTruthy();
    }
  });
});
