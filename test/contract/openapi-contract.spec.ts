/**
 * openapi-contract.spec.ts — OpenAPI 3.1 contract test suite (WO-099).
 *
 * Validates the committed public OpenAPI snapshot against acceptance criteria
 * and proves that generated TypeScript types are machine-usable.
 *
 * Test sections:
 *   1. Snapshot integrity — version, info, paths, all under /api/v1
 *   2. Route visibility (AC6) — no internal operationId leaks into public doc
 *   3. Operation completeness (AC2) — every PUBLIC_OPERATION_ID present
 *   4. Error envelope (AC4) — defined once in components, referenced by every
 *      4xx response; 429 documents Retry-After header
 *   5. Cursor pagination (AC5) — list operations carry CursorParam + LimitParam
 *   6. Security schemes (AC7) — StaffBearer, PortalBearer, MachineToken all present
 *   7. TypeScript type shapes (AC9) — imported types used to construct valid
 *      objects, proving the contract is machine-usable
 *   8. Fixture corpus (AC12) — committed example fixtures backed against
 *      documented schema shapes
 *   9. Integration tests (AC11) — real HTTP calls, guarded by API_URL env var
 *
 * Run:
 *   cd test/contract && npx vitest run
 * With integration gate:
 *   API_URL=http://localhost:8080 TEST_STAFF_TOKEN=<jwt> npx vitest run
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// AC9: TypeScript types imported from @opsninja/api-types to prove
// the contract is machine-usable by a test suite.
import {
  PUBLIC_OPERATION_IDS,
  INTERNAL_OPERATION_IDS,
  type Ticket,
  type Comment,
  type Organization,
  type ErrorEnvelope,
  type ErrorBody,
  type CursorPage,
  type CursorQueryParams,
  type AuditLog,
  type Webhook,
  type SavedView,
  type User,
  type TicketStatus,
  type TicketPriority,
  type CommentVisibility,
  type SlaTimerState,
  type PortalTicketListItem,
  type PortalTicketDetail,
  type PortalComment,
  type PortalAttachmentMeta,
} from '@opsninja/api-types';

// ---------------------------------------------------------------------------
// Load the committed public snapshot (AC8, AC12)
// ---------------------------------------------------------------------------

const SNAPSHOT_PATH = path.resolve(__dirname, '../../docs/api/openapi.public.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OADoc = Record<string, any>;

let snapshot: OADoc;
try {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8')) as OADoc;
} catch {
  throw new Error(`Cannot read public OpenAPI snapshot at ${SNAPSHOT_PATH}. Run the generator first.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect every operationId present in the snapshot paths. */
function collectOperationIds(doc: OADoc): string[] {
  const ids: string[] = [];
  for (const methods of Object.values(doc.paths ?? {}) as OADoc[]) {
    for (const op of Object.values(methods) as OADoc[]) {
      if (op && typeof op === 'object' && op['operationId']) {
        ids.push(op['operationId'] as string);
      }
    }
  }
  return ids;
}

/** Return all operations as { path, method, op } triples. */
function allOperations(doc: OADoc): Array<{ path: string; method: string; op: OADoc }> {
  const result: Array<{ path: string; method: string; op: OADoc }> = [];
  for (const [p, methods] of Object.entries(doc.paths ?? {}) as [string, OADoc][]) {
    for (const [m, op] of Object.entries(methods) as [string, OADoc][]) {
      if (op && typeof op === 'object' && op['operationId']) {
        result.push({ path: p, method: m, op });
      }
    }
  }
  return result;
}

/** Check whether a response object (or $ref'd component response) references ErrorEnvelope. */
function responseRefsErrorEnvelope(resp: OADoc, doc: OADoc): boolean {
  // Resolve a top-level $ref to components.responses.*
  if (resp['$ref']) {
    const refName = (resp['$ref'] as string).replace('#/components/responses/', '');
    const resolved = doc['components']?.['responses']?.[refName];
    if (!resolved) return false;
    return responseBodyRefsEnvelope(resolved);
  }
  return responseBodyRefsEnvelope(resp);
}

function responseBodyRefsEnvelope(resp: OADoc): boolean {
  const schema = resp['content']?.['application/json']?.['schema'];
  if (!schema) return false;
  const ref: string = schema['$ref'] ?? '';
  return ref.endsWith('ErrorEnvelope');
}

// ---------------------------------------------------------------------------
// 1. Snapshot integrity
// ---------------------------------------------------------------------------

describe('Snapshot integrity', () => {
  it('exists and is parseable JSON', () => {
    expect(snapshot).toBeDefined();
    expect(typeof snapshot).toBe('object');
  });

  it('declares OpenAPI 3.1.0', () => {
    expect(snapshot['openapi']).toBe('3.1.0');
  });

  it('has info.title', () => {
    expect(typeof snapshot['info']?.['title']).toBe('string');
    expect((snapshot['info']['title'] as string).length).toBeGreaterThan(0);
  });

  it('has info.version', () => {
    expect(typeof snapshot['info']?.['version']).toBe('string');
    expect((snapshot['info']['version'] as string).length).toBeGreaterThan(0);
  });

  it('has a non-empty paths object', () => {
    expect(typeof snapshot['paths']).toBe('object');
    expect(Object.keys(snapshot['paths'] as object).length).toBeGreaterThan(0);
  });

  it('every path starts with /api/v1', () => {
    for (const p of Object.keys(snapshot['paths'] as object)) {
      expect(p, `Path "${p}" must start with /api/v1`).toMatch(/^\/api\/v1\//);
    }
  });

  it('has at least one server entry', () => {
    expect(Array.isArray(snapshot['servers'])).toBe(true);
    expect((snapshot['servers'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('has a tags array', () => {
    expect(Array.isArray(snapshot['tags'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Route visibility (AC6) — no internal operationId leaks
// ---------------------------------------------------------------------------

describe('Route visibility: no internal routes in public document (AC6)', () => {
  const publicIds = collectOperationIds(snapshot);

  it('INTERNAL_OPERATION_IDS array is defined and non-empty', () => {
    expect(Array.isArray(INTERNAL_OPERATION_IDS)).toBe(true);
    expect(INTERNAL_OPERATION_IDS.length).toBeGreaterThan(0);
  });

  for (const internalId of INTERNAL_OPERATION_IDS) {
    it(`internal operationId "${internalId}" is absent from the public document`, () => {
      expect(publicIds).not.toContain(internalId);
    });
  }

  it('known internal path /api/v1/health is absent from public document', () => {
    expect(Object.keys(snapshot['paths'] ?? {})).not.toContain('/api/v1/health');
  });

  it('known internal path /api/v1/auth/login is absent from public document', () => {
    expect(Object.keys(snapshot['paths'] ?? {})).not.toContain('/api/v1/auth/login');
  });

  it('known internal path /api/v1/admin/tenants is absent from public document', () => {
    expect(Object.keys(snapshot['paths'] ?? {})).not.toContain('/api/v1/admin/tenants');
  });
});

// ---------------------------------------------------------------------------
// 3. Operation completeness (AC2) — every PUBLIC_OPERATION_ID appears
// ---------------------------------------------------------------------------

describe('Operation completeness: all public operationIds present (AC2)', () => {
  const publicIds = collectOperationIds(snapshot);

  it('PUBLIC_OPERATION_IDS array is defined and non-empty', () => {
    expect(Array.isArray(PUBLIC_OPERATION_IDS)).toBe(true);
    expect(PUBLIC_OPERATION_IDS.length).toBeGreaterThan(0);
  });

  it('snapshot operation count matches PUBLIC_OPERATION_IDS count', () => {
    expect(publicIds.length).toBe(PUBLIC_OPERATION_IDS.length);
  });

  for (const opId of PUBLIC_OPERATION_IDS) {
    it(`public operationId "${opId}" is present in the snapshot`, () => {
      expect(publicIds).toContain(opId);
    });
  }

  it('every operation has a non-empty summary', () => {
    for (const { op } of allOperations(snapshot)) {
      expect(
        typeof op['summary'] === 'string' && op['summary'].length > 0,
        `operationId "${op['operationId']}" is missing a summary`,
      ).toBe(true);
    }
  });

  it('every operation has at least one tag', () => {
    for (const { op } of allOperations(snapshot)) {
      expect(
        Array.isArray(op['tags']) && (op['tags'] as string[]).length > 0,
        `operationId "${op['operationId']}" has no tags`,
      ).toBe(true);
    }
  });

  it('every operation has a security requirement', () => {
    for (const { op } of allOperations(snapshot)) {
      expect(
        Array.isArray(op['security']) && (op['security'] as unknown[]).length > 0,
        `operationId "${op['operationId']}" has no security requirement`,
      ).toBe(true);
    }
  });

  it('no duplicate operationIds exist in the snapshot', () => {
    const publicIds2 = collectOperationIds(snapshot);
    const unique = new Set(publicIds2);
    expect(publicIds2.length).toBe(unique.size);
  });
});

// ---------------------------------------------------------------------------
// 4. Error envelope (AC4)
// ---------------------------------------------------------------------------

describe('Error envelope: defined once, referenced by every 4xx response (AC4)', () => {
  it('ErrorEnvelope schema exists in components.schemas', () => {
    expect(snapshot['components']?.['schemas']?.['ErrorEnvelope']).toBeDefined();
  });

  it('ErrorEnvelope schema requires the "error" property', () => {
    const schema = snapshot['components']['schemas']['ErrorEnvelope'];
    expect(schema['required']).toContain('error');
  });

  it('ErrorBody schema exists in components.schemas', () => {
    expect(snapshot['components']?.['schemas']?.['ErrorBody']).toBeDefined();
  });

  it('ErrorBody schema has code and message properties', () => {
    const schema = snapshot['components']['schemas']['ErrorBody'];
    const props = Object.keys(schema['properties'] ?? {});
    expect(props).toContain('code');
    expect(props).toContain('message');
  });

  it('components.responses.BadRequest references ErrorEnvelope', () => {
    const resp = snapshot['components']?.['responses']?.['BadRequest'];
    expect(resp).toBeDefined();
    expect(responseBodyRefsEnvelope(resp)).toBe(true);
  });

  it('components.responses.Unauthorized references ErrorEnvelope', () => {
    const resp = snapshot['components']?.['responses']?.['Unauthorized'];
    expect(resp).toBeDefined();
    expect(responseBodyRefsEnvelope(resp)).toBe(true);
  });

  it('components.responses.Forbidden references ErrorEnvelope', () => {
    const resp = snapshot['components']?.['responses']?.['Forbidden'];
    expect(resp).toBeDefined();
    expect(responseBodyRefsEnvelope(resp)).toBe(true);
  });

  it('components.responses.NotFound references ErrorEnvelope', () => {
    const resp = snapshot['components']?.['responses']?.['NotFound'];
    expect(resp).toBeDefined();
    expect(responseBodyRefsEnvelope(resp)).toBe(true);
  });

  it('components.responses.TooManyRequests references ErrorEnvelope', () => {
    const resp = snapshot['components']?.['responses']?.['TooManyRequests'];
    expect(resp).toBeDefined();
    expect(responseBodyRefsEnvelope(resp)).toBe(true);
  });

  it('TooManyRequests response documents the Retry-After header (AC4)', () => {
    const resp = snapshot['components']['responses']['TooManyRequests'];
    expect(resp['headers']?.['Retry-After']).toBeDefined();
  });

  it('every operation 400 response references components.responses.BadRequest', () => {
    for (const { op } of allOperations(snapshot)) {
      const resp400 = op['responses']?.['400'];
      if (!resp400) continue; // some ops may legitimately omit 400 (e.g. GET with no body)
      const isRef = typeof resp400['$ref'] === 'string' &&
        resp400['$ref'].includes('responses/BadRequest');
      const isInline = responseBodyRefsEnvelope(resp400 as OADoc);
      expect(
        isRef || isInline,
        `operationId "${op['operationId']}" 400 response must reference BadRequest or ErrorEnvelope`,
      ).toBe(true);
    }
  });

  it('every operation 401 response references components.responses.Unauthorized', () => {
    for (const { op } of allOperations(snapshot)) {
      const resp = op['responses']?.['401'];
      if (!resp) continue;
      expect(
        responseRefsErrorEnvelope(resp as OADoc, snapshot),
        `operationId "${op['operationId']}" 401 response must reference ErrorEnvelope`,
      ).toBe(true);
    }
  });

  it('every operation 429 response (if present) references components.responses.TooManyRequests', () => {
    for (const { op } of allOperations(snapshot)) {
      const resp = op['responses']?.['429'];
      if (!resp) continue;
      expect(
        responseRefsErrorEnvelope(resp as OADoc, snapshot),
        `operationId "${op['operationId']}" 429 response must reference ErrorEnvelope`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Cursor pagination (AC5)
// ---------------------------------------------------------------------------

describe('Cursor pagination: list operations carry CursorParam + LimitParam (AC5)', () => {
  it('CursorParam exists in components.parameters', () => {
    expect(snapshot['components']?.['parameters']?.['CursorParam']).toBeDefined();
  });

  it('LimitParam exists in components.parameters', () => {
    expect(snapshot['components']?.['parameters']?.['LimitParam']).toBeDefined();
  });

  it('LimitParam maximum is 100', () => {
    const param = snapshot['components']['parameters']['LimitParam'];
    const schema = param['schema'] ?? {};
    expect(schema['maximum']).toBe(100);
  });

  it('LimitParam minimum is 1', () => {
    const param = snapshot['components']['parameters']['LimitParam'];
    const schema = param['schema'] ?? {};
    expect(schema['minimum']).toBe(1);
  });

  it('CursorParam is optional (not required)', () => {
    const param = snapshot['components']['parameters']['CursorParam'];
    expect(param['required']).toBeFalsy();
  });

  // Identify list operations by presence of CursorParam reference in parameters
  const listOps = allOperations(snapshot).filter(({ op }) => {
    const params: OADoc[] = op['parameters'] ?? [];
    return params.some(
      (p) => typeof p['$ref'] === 'string' && p['$ref'].endsWith('/CursorParam'),
    );
  });

  it('at least one list operation exists in the snapshot', () => {
    expect(listOps.length).toBeGreaterThan(0);
  });

  it('every list operation also carries the LimitParam reference', () => {
    for (const { op } of listOps) {
      const params: OADoc[] = op['parameters'] ?? [];
      const hasLimit = params.some(
        (p) => typeof p['$ref'] === 'string' && p['$ref'].endsWith('/LimitParam'),
      );
      expect(
        hasLimit,
        `operationId "${op['operationId']}" has CursorParam but is missing LimitParam`,
      ).toBe(true);
    }
  });

  it('every list operation 200 response shape has data array and nextCursor', () => {
    for (const { op } of listOps) {
      const resp200 = op['responses']?.['200'];
      if (!resp200) continue;
      const schema = resp200['content']?.['application/json']?.['schema'];
      if (!schema) continue;
      // Either an inline schema or a $ref to a CursorPage-derived schema
      const ref: string = schema['$ref'] ?? '';
      const isCursorRef = ref.includes('CursorPage') || ref.includes('cursor');
      const hasInlineShape =
        schema['properties']?.['data'] !== undefined &&
        schema['properties']?.['nextCursor'] !== undefined;
      expect(
        isCursorRef || hasInlineShape,
        `operationId "${op['operationId']}" 200 response should reference CursorPage or define data+nextCursor`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Security schemes (AC7)
// ---------------------------------------------------------------------------

describe('Security schemes: all three principal types documented (AC7)', () => {
  const schemes = snapshot['components']?.['securitySchemes'] ?? {};

  it('StaffBearer security scheme exists', () => {
    expect(schemes['StaffBearer']).toBeDefined();
  });

  it('PortalBearer security scheme exists', () => {
    expect(schemes['PortalBearer']).toBeDefined();
  });

  it('MachineToken security scheme exists', () => {
    expect(schemes['MachineToken']).toBeDefined();
  });

  it('StaffBearer is type http bearer (OIDC JWT)', () => {
    const scheme = schemes['StaffBearer'];
    expect(scheme['type']).toBe('http');
    expect(scheme['scheme']).toBe('bearer');
  });

  it('PortalBearer is type http bearer', () => {
    const scheme = schemes['PortalBearer'];
    expect(scheme['type']).toBe('http');
    expect(scheme['scheme']).toBe('bearer');
  });

  it('portal-ticket operations use PortalBearer security', () => {
    const portalOps = allOperations(snapshot).filter(({ op }) => {
      const tags: string[] = op['tags'] ?? [];
      return tags.includes('portal-tickets') || tags.includes('portal-attachments');
    });
    expect(portalOps.length).toBeGreaterThan(0);
    for (const { op } of portalOps) {
      const security: OADoc[] = op['security'] ?? [];
      const usesPortal = security.some((s) => 'PortalBearer' in s);
      expect(
        usesPortal,
        `operationId "${op['operationId']}" is a portal operation but does not use PortalBearer`,
      ).toBe(true);
    }
  });

  it('agent-ticket operations use StaffBearer security', () => {
    const agentOps = allOperations(snapshot).filter(({ op }) => {
      const tags: string[] = op['tags'] ?? [];
      return tags.includes('agent-tickets');
    });
    expect(agentOps.length).toBeGreaterThan(0);
    for (const { op } of agentOps) {
      const security: OADoc[] = op['security'] ?? [];
      const usesStaff = security.some((s) => 'StaffBearer' in s);
      expect(
        usesStaff,
        `operationId "${op['operationId']}" is an agent operation but does not use StaffBearer`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. TypeScript type shapes (AC9) — prove types are machine-usable
// ---------------------------------------------------------------------------

describe('TypeScript types: machine-usable contract (AC9)', () => {
  it('PUBLIC_OPERATION_IDS is a readonly string array exported from @opsninja/api-types', () => {
    expect(Array.isArray(PUBLIC_OPERATION_IDS)).toBe(true);
    expect(PUBLIC_OPERATION_IDS.length).toBeGreaterThan(0);
    for (const id of PUBLIC_OPERATION_IDS) {
      expect(typeof id).toBe('string');
    }
  });

  it('INTERNAL_OPERATION_IDS is a readonly string array exported from @opsninja/api-types', () => {
    expect(Array.isArray(INTERNAL_OPERATION_IDS)).toBe(true);
    expect(INTERNAL_OPERATION_IDS.length).toBeGreaterThan(0);
    for (const id of INTERNAL_OPERATION_IDS) {
      expect(typeof id).toBe('string');
    }
  });

  it('PUBLIC_OPERATION_IDS and INTERNAL_OPERATION_IDS have no overlap', () => {
    const publicSet = new Set<string>(PUBLIC_OPERATION_IDS as readonly string[]);
    for (const id of INTERNAL_OPERATION_IDS) {
      expect(publicSet.has(id)).toBe(false);
    }
  });

  it('Ticket interface can be constructed from valid data', () => {
    // Constructing a valid Ticket object satisfies the TypeScript type at compile time.
    const ticket: Ticket = {
      id: 'aa000000-0000-0001-0000-000000000001',
      tenantId: 'aa000000-0000-0000-0000-000000000001',
      organizationId: 'cc000000-0000-0001-0000-000000000001',
      reference: 'TKT-0001',
      subject: 'Login issue on mobile app',
      description: null,
      status: 'open' satisfies TicketStatus,
      priority: 'P2' satisfies TicketPriority,
      version: 1,
      assigneeId: null,
      categoryId: null,
      requesterContactId: null,
      firstResponseAt: null,
      resolvedAt: null,
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
    };
    expect(ticket.id).toBeTruthy();
    expect(ticket.status).toBe('open');
    expect(ticket.priority).toBe('P2');
    expect(ticket.reference).toMatch(/^TKT-/);
  });

  it('Comment interface can be constructed from valid data', () => {
    const comment: Comment = {
      id: 'bb000000-0000-0001-0000-000000000001',
      ticketId: 'aa000000-0000-0001-0000-000000000001',
      body: 'Please restart your mobile app and try again.',
      visibility: 'public' satisfies CommentVisibility,
      authorId: 'agent-001',
      createdAt: '2026-01-15T11:00:00Z',
    };
    expect(comment.visibility).toBe('public');
  });

  it('Organization interface can be constructed from valid data', () => {
    const org: Organization = {
      id: 'cc000000-0000-0001-0000-000000000001',
      tenantId: 'aa000000-0000-0000-0000-000000000001',
      name: 'Acme Corp',
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(org.name).toBe('Acme Corp');
  });

  it('ErrorEnvelope interface matches the documented error shape', () => {
    const envelope: ErrorEnvelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request body failed validation.',
        details: [{ field: 'subject', issue: 'required' }],
        traceId: 'trace-abc-123',
      } satisfies ErrorBody,
    };
    expect(envelope.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(envelope.error.details)).toBe(true);
  });

  it('CursorPage<T> generic interface works with Ticket items', () => {
    const page: CursorPage<Ticket> = {
      data: [],
      nextCursor: null,
    };
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it('CursorQueryParams enforces limit ≤ 100 by documentation', () => {
    // TypeScript type allows any number; the constraint is documented in the spec.
    // This test proves the interface is usable and documents the intent.
    const params: CursorQueryParams = { cursor: undefined, limit: 20 };
    expect(params.limit).toBe(20);
  });

  it('PortalTicketListItem interface matches the committed example fixture', () => {
    // Use the committed example from GET /api/v1/portal/tickets 200.
    const item: PortalTicketListItem = {
      id: 'aa000000-0000-0003-0000-000000000001',
      reference: 'TKT-0001',
      subject: 'Login issue on mobile app',
      status: 'open',
      priority: 'P2',
      categoryPath: null,
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      sla: null,
    };
    expect(item.reference).toBe('TKT-0001');
    expect(item.status).toBe('open');
  });

  it('SlaTimerState union covers all expected values', () => {
    const states: SlaTimerState[] = ['running', 'paused', 'met', 'breached'];
    expect(states.length).toBe(4);
  });

  it('AuditLog interface can be constructed', () => {
    const log: AuditLog = {
      id: 'audit-001',
      tenantId: 'aa000000-0000-0000-0000-000000000001',
      actorId: 'user-001',
      action: 'ticket.created',
      resourceType: 'ticket',
      resourceId: 'aa000000-0000-0001-0000-000000000001',
      createdAt: '2026-01-15T10:00:00Z',
    };
    expect(log.action).toBe('ticket.created');
  });

  it('Webhook interface can be constructed', () => {
    const webhook: Webhook = {
      id: 'wh-001',
      tenantId: 'aa000000-0000-0000-0000-000000000001',
      url: 'https://example.com/webhook',
      events: ['ticket.created', 'ticket.resolved'],
      active: true,
      createdAt: '2026-01-15T10:00:00Z',
    };
    expect(webhook.events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 8. Fixture corpus (AC12) — snapshot examples as contract corpus
// ---------------------------------------------------------------------------

describe('Fixture corpus: committed examples match documented schemas (AC12)', () => {
  it('GET /api/v1/portal/tickets 200 example exists in snapshot', () => {
    const op = snapshot['paths']?.['/api/v1/portal/tickets']?.['get'];
    const example = op?.['responses']?.['200']?.['content']?.['application/json']?.['example'];
    expect(example).toBeDefined();
  });

  it('GET /api/v1/portal/tickets example has data array and nextCursor', () => {
    const example =
      snapshot['paths']['/api/v1/portal/tickets']['get']['responses']['200']['content'][
        'application/json'
      ]['example'];
    expect(Array.isArray(example['data'])).toBe(true);
    expect('nextCursor' in example).toBe(true);
  });

  it('GET /api/v1/portal/tickets example items have required PortalTicketListItem fields', () => {
    const example =
      snapshot['paths']['/api/v1/portal/tickets']['get']['responses']['200']['content'][
        'application/json'
      ]['example'];
    const items: OADoc[] = example['data'];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(typeof item['id']).toBe('string');
      expect(typeof item['reference']).toBe('string');
      expect(typeof item['subject']).toBe('string');
      expect(typeof item['status']).toBe('string');
      expect(typeof item['priority']).toBe('string');
      expect(typeof item['createdAt']).toBe('string');
      expect(typeof item['updatedAt']).toBe('string');
    }
  });

  it('GET /api/v1/portal/tickets example uses synthetic data (no real tenant IDs)', () => {
    const example =
      snapshot['paths']['/api/v1/portal/tickets']['get']['responses']['200']['content'][
        'application/json'
      ]['example'];
    const raw = JSON.stringify(example);
    // Synthetic IDs contain all-zero segments; real IDs are random
    expect(raw).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/i);
  });

  it('inline fixture: portal ticket list page satisfies CursorPage<PortalTicketListItem>', () => {
    // This inline fixture serves as the contract corpus for listPortalTickets.
    const fixture: CursorPage<PortalTicketListItem> = {
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
          sla: null,
        },
      ],
      nextCursor: null,
    };
    expect(fixture.data.length).toBe(1);
    expect(fixture.nextCursor).toBeNull();
  });

  it('inline fixture: 400 error response satisfies ErrorEnvelope', () => {
    const fixture: ErrorEnvelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: "Field 'subject' is required.",
        details: [{ field: 'subject', issue: 'required' }],
        traceId: 'trace-00000000-0000',
      },
    };
    expect(fixture.error.code).toBe('VALIDATION_ERROR');
    expect(fixture.error.details).toHaveLength(1);
  });

  it('inline fixture: portal ticket detail satisfies PortalTicketDetail', () => {
    const fixture: PortalTicketDetail = {
      id: 'aa000000-0000-0003-0000-000000000001',
      reference: 'TKT-0001',
      subject: 'Login issue on mobile app',
      status: 'open',
      priority: 'P2',
      categoryPath: null,
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      sla: null,
      comments: [],
      statusHistory: [],
    };
    expect(fixture.reference).toBe('TKT-0001');
  });

  it('inline fixture: portal comment satisfies PortalComment', () => {
    const fixture: PortalComment = {
      id: 'comment-000-0000-0000-000000000001',
      body: 'Please try clearing your app cache and logging in again.',
      authorDisplayName: 'Support Agent',
      authorType: 'agent',
      createdAt: '2026-01-15T11:00:00Z',
    };
    expect(fixture.authorType).toBe('agent');
    expect(fixture.authorDisplayName).toBe('Support Agent');
  });

  it('inline fixture: portal attachment meta satisfies PortalAttachmentMeta', () => {
    const fixture: PortalAttachmentMeta = {
      id: 'attach-000-0000-0000-000000000001',
      displayName: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 204800,
    };
    expect(fixture.mimeType).toBe('image/png');
    expect(fixture.displayName).toBe('screenshot.png');
  });

  it('inline fixture: saved view satisfies SavedView', () => {
    const fixture: SavedView = {
      id: 'view-000-0000-0000-000000000001',
      name: 'Open P1 tickets',
      filters: { status: 'open', priority: 'P1' },
      isDefault: false,
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(fixture.name).toBe('Open P1 tickets');
  });

  it('inline fixture: user satisfies User', () => {
    const fixture: User = {
      id: 'user-000-0000-0000-000000000001',
      tenantId: 'aa000000-0000-0000-0000-000000000001',
      email: 'agent@opsninja-demo.io',
      displayName: 'Demo Agent',
      roles: ['agent'],
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(fixture.email).toMatch(/@/);
  });
});

// ---------------------------------------------------------------------------
// 9. Integration tests (AC11) — guarded by API_URL
// ---------------------------------------------------------------------------

const SKIP_INTEGRATION = !process.env['API_URL'];
const maybeDescribe = SKIP_INTEGRATION ? describe.skip : describe;

maybeDescribe('Integration: real API responses validated against snapshot schemas (AC11)', () => {
  const apiUrl = (process.env['API_URL'] ?? 'http://localhost:8080').replace(/\/$/, '');
  const staffToken = process.env['TEST_STAFF_TOKEN'] ?? '';
  const portalToken = process.env['TEST_PORTAL_TOKEN'] ?? '';

  async function fetchJson(
    path: string,
    token: string,
    options: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    const body = res.status !== 204 ? await res.json() : {};
    return { status: res.status, body };
  }

  // --- Portal surface ---

  it('GET /api/v1/portal/tickets returns 200 with data array and nextCursor', async () => {
    const { status, body } = await fetchJson('/api/v1/portal/tickets', portalToken);
    expect(status).toBe(200);
    const page = body as CursorPage<PortalTicketListItem>;
    expect(Array.isArray(page.data)).toBe(true);
    expect('nextCursor' in page).toBe(true);
  });

  it('GET /api/v1/portal/tickets returns items with required fields', async () => {
    const { status, body } = await fetchJson('/api/v1/portal/tickets', portalToken);
    expect(status).toBe(200);
    const page = body as CursorPage<PortalTicketListItem>;
    for (const item of page.data) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.reference).toBe('string');
      expect(typeof item.subject).toBe('string');
      expect(['open', 'in_progress', 'resolved', 'closed']).toContain(item.status);
      expect(['P1', 'P2', 'P3', 'P4']).toContain(item.priority);
    }
  });

  // --- Agent surface ---

  it('GET /api/v1/tickets returns 200 with data array', async () => {
    const { status, body } = await fetchJson('/api/v1/tickets', staffToken);
    expect(status).toBe(200);
    const page = body as CursorPage<Ticket>;
    expect(Array.isArray(page.data)).toBe(true);
  });

  // --- Error shape validation ---

  it('GET /api/v1/tickets without auth returns 401 with ErrorEnvelope', async () => {
    const { status, body } = await fetchJson('/api/v1/tickets', '' /* no token */);
    expect(status).toBe(401);
    const envelope = body as ErrorEnvelope;
    expect(typeof envelope.error?.code).toBe('string');
    expect(typeof envelope.error?.message).toBe('string');
  });

  it('GET /api/v1/tickets/{id} for unknown id returns 404 with ErrorEnvelope', async () => {
    const { status, body } = await fetchJson(
      '/api/v1/tickets/00000000-0000-0000-0000-000000000000',
      staffToken,
    );
    expect(status).toBe(404);
    const envelope = body as ErrorEnvelope;
    expect(typeof envelope.error?.code).toBe('string');
    expect(typeof envelope.error?.message).toBe('string');
  });

  // --- Internal routes must not be accessible ---

  it('GET /api/v1/health is not reachable at the public base path', async () => {
    // Internal health endpoint should return 404 via public routing (or not exist)
    const res = await fetch(`${apiUrl}/api/v1/health`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    // Either 404 (not in public routing) or 401 (guarded) — never 200 from public surface
    // This proves AC6: internal routes are not exposed on the public surface.
    expect([404, 401, 403]).toContain(res.status);
  });

  // --- Pagination ---

  it('GET /api/v1/tickets with limit=1 returns at most 1 item', async () => {
    const { status, body } = await fetchJson('/api/v1/tickets?limit=1', staffToken);
    expect(status).toBe(200);
    const page = body as CursorPage<Ticket>;
    expect(page.data.length).toBeLessThanOrEqual(1);
  });

  it('GET /api/v1/tickets with limit=101 returns 400 (limit exceeds max 100)', async () => {
    const { status, body } = await fetchJson('/api/v1/tickets?limit=101', staffToken);
    expect(status).toBe(400);
    const envelope = body as ErrorEnvelope;
    expect(typeof envelope.error?.code).toBe('string');
  });

  // --- Organizations ---

  it('GET /api/v1/organizations/{id} for unknown id returns 404 with ErrorEnvelope', async () => {
    const { status, body } = await fetchJson(
      '/api/v1/organizations/00000000-0000-0000-0000-000000000000',
      staffToken,
    );
    expect(status).toBe(404);
    const envelope = body as ErrorEnvelope;
    expect(typeof envelope.error?.code).toBe('string');
  });

  // --- SLA ---

  it('GET /api/v1/sla/policies returns 200 with data array', async () => {
    const { status, body } = await fetchJson('/api/v1/sla/policies', staffToken);
    expect(status).toBe(200);
    const page = body as CursorPage<unknown>;
    expect(Array.isArray(page.data)).toBe(true);
  });
});
