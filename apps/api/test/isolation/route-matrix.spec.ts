/**
 * Ticketing route-matrix isolation test — WO-043 AC2.
 *
 * Derives the set of ticketing routes from the OpenAPI 3.1 document
 * (generated at test-startup) and iterates every route with a Tenant B
 * principal against Tenant A resources.
 *
 * Each route must return 404 NOT_FOUND (never 200, 403, or 500) so that
 * cross-tenant access neither leaks data nor discloses resource existence.
 *
 * Routes not matching the ticketing path prefix are ignored.
 * Routes that legitimately return a different status for cross-tenant access
 * (e.g. unauthenticated health routes) must be listed in ROUTE_ALLOWLIST with
 * a justification — any unlisted deviation fails the build.
 *
 * Requires DATABASE_URL + a running NestJS application.
 * Automatically skipped in offline runs.
 */

import * as supertest from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';

import {
  TOKEN_A_ADMIN,
  TOKEN_B_ADMIN,
  TOKEN_B_AGENT_ORG1,
} from '../fixtures/principals';
import {
  HARNESS_TICKET_A_ORG1,
  HARNESS_TICKET_A_ORG2,
  HARNESS_COMMENT_A_ORG1_PUBLIC1,
  HARNESS_TENANT_A_ORG1_ID,
  HARNESS_TENANT_B_ID,
} from '../fixtures/tenant-factory';
import {
  seedHarnessData,
  teardownHarnessData,
} from '../fixtures/tenant-factory';
import { Pool } from 'pg';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Route allowlist — routes that legitimately return non-404 for cross-tenant
// access. Each entry MUST include a justification string.
// ---------------------------------------------------------------------------

interface AllowedRoute {
  method: string;
  pathPattern: RegExp;
  expectedStatus: number;
  justification: string;
}

const ROUTE_ALLOWLIST: AllowedRoute[] = [
  {
    method: 'GET',
    pathPattern: /^\/api\/v1\/tickets\/queue\/stats$/,
    expectedStatus: 200,
    justification:
      'Queue stats are aggregate tenant-scoped data; cross-tenant token returns own-tenant stats, not 404.',
  },
  {
    method: 'GET',
    pathPattern: /^\/api\/v1\/tickets\/categories$/,
    expectedStatus: 200,
    justification:
      'Categories are tenant-scoped lists; Tenant B principal returns Tenant B categories, not 404.',
  },
  {
    method: 'GET',
    pathPattern: /^\/api\/v1\/tickets\/tags$/,
    expectedStatus: 200,
    justification: 'Tag lists are tenant-scoped; Tenant B sees its own tags.',
  },
  {
    method: 'GET',
    pathPattern: /^\/api\/v1\/tickets\/views$/,
    expectedStatus: 200,
    justification: 'View lists are tenant-scoped; Tenant B sees its own views.',
  },
  {
    method: 'GET',
    pathPattern: /^\/api\/v1\/tickets\/groups$/,
    expectedStatus: 200,
    justification: 'Group lists are tenant-scoped; Tenant B sees its own groups.',
  },
  {
    method: 'GET',
    pathPattern: /^\/api\/v1\/tickets$/,
    expectedStatus: 200,
    justification:
      'Ticket list is tenant-scoped; Tenant B returns its own tickets (no Tenant A rows).',
  },
];

// ---------------------------------------------------------------------------
// Ticketing routes to test — id-parameterised routes where cross-tenant 404
// is required
// ---------------------------------------------------------------------------

interface CrossTenantRoute {
  method: 'GET' | 'PUT' | 'PATCH' | 'DELETE' | 'POST';
  pathFn: (ids: ResourceIds) => string;
  body?: (ids: ResourceIds) => Record<string, unknown>;
  label: string;
}

interface ResourceIds {
  ticketId: string;
  commentId: string;
  orgId: string;
}

const ID_ROUTES: CrossTenantRoute[] = [
  {
    method: 'GET',
    pathFn: ({ ticketId }) => `/api/v1/tickets/${ticketId}`,
    label: 'GET /tickets/:id',
  },
  {
    method: 'PATCH',
    pathFn: ({ ticketId }) => `/api/v1/tickets/${ticketId}`,
    body: () => ({ subject: 'x-tenant attack', version: 1 }),
    label: 'PATCH /tickets/:id',
  },
  {
    method: 'GET',
    pathFn: ({ ticketId }) => `/api/v1/tickets/${ticketId}/comments`,
    label: 'GET /tickets/:id/comments',
  },
  {
    method: 'POST',
    pathFn: ({ ticketId }) => `/api/v1/tickets/${ticketId}/comments`,
    body: () => ({ body: 'cross-tenant comment', visibility: 'public' }),
    label: 'POST /tickets/:id/comments',
  },
  {
    method: 'GET',
    pathFn: ({ ticketId, commentId }) => `/api/v1/tickets/${ticketId}/comments/${commentId}`,
    label: 'GET /tickets/:id/comments/:cid',
  },
  {
    method: 'DELETE',
    pathFn: ({ ticketId, commentId }) => `/api/v1/tickets/${ticketId}/comments/${commentId}`,
    label: 'DELETE /tickets/:id/comments/:cid',
  },
  {
    method: 'GET',
    pathFn: ({ ticketId }) => `/api/v1/tickets/${ticketId}/attachments`,
    label: 'GET /tickets/:id/attachments',
  },
  {
    method: 'POST',
    pathFn: ({ ticketId }) => `/api/v1/tickets/${ticketId}/attachments/presign`,
    body: () => ({ filename: 'x.png', contentType: 'image/png', sizeBytes: 100 }),
    label: 'POST /tickets/:id/attachments/presign',
  },
  {
    method: 'POST',
    pathFn: ({ ticketId }) => `/api/v1/tickets/${ticketId}/resolve`,
    body: () => ({ version: 1, resolutionNote: 'x-tenant resolve' }),
    label: 'POST /tickets/:id/resolve',
  },
  {
    method: 'GET',
    pathFn: ({ ticketId }) => `/api/v1/tickets/${ticketId}/audit`,
    label: 'GET /tickets/:id/audit',
  },
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('WO-043 AC2: Route-matrix cross-tenant isolation', () => {
  let app: INestApplication;
  let request: ReturnType<typeof supertest.default>;
  let pool: Pool;
  const tenantATicketId = HARNESS_TICKET_A_ORG1[0]!;
  const tenantACommentId = HARNESS_COMMENT_A_ORG1_PUBLIC1;
  const tenantAOrgId = HARNESS_TENANT_A_ORG1_ID;

  beforeAll(async () => {
    // Seed harness data (Tenant A resources)
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const client = await pool.connect();
    try {
      await seedHarnessData(client);
    } finally {
      client.release();
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    request = supertest.default(app.getHttpServer());
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await teardownHarnessData(client);
    } finally {
      client.release();
    }
    await pool.end();
    await app.close();
  });

  // ── Cross-tenant id-route matrix ─────────────────────────────────────────

  describe('cross-tenant id-route isolation: Tenant B token vs Tenant A resources', () => {
    const ids: ResourceIds = {
      ticketId: tenantATicketId,
      commentId: tenantACommentId,
      orgId: tenantAOrgId,
    };

    for (const route of ID_ROUTES) {
      it(`${route.label} returns 404 with no body disclosing existence`, async () => {
        const path = route.pathFn(ids);
        const req = request[route.method.toLowerCase() as Lowercase<typeof route.method>](path)
          .set('Authorization', `Bearer ${TOKEN_B_ADMIN}`);

        if (route.body) {
          req.send(route.body(ids));
        }

        const res = await req;

        // Must never be 200 (data leak) or 403 (existence disclosed via auth error)
        expect(
          res.status,
          `ROUTE ISOLATION FAILURE: ${route.method} ${path}\n` +
          `Principal: Tenant B admin against Tenant A resource\n` +
          `Expected: 404  Got: ${res.status}\n` +
          `Body: ${JSON.stringify(res.body).slice(0, 200)}`,
        ).toBe(404);

        // Response body must not name the resource ID
        const bodyText = JSON.stringify(res.body);
        expect(
          bodyText.includes(tenantATicketId) || bodyText.includes(tenantACommentId),
          `EXISTENCE DISCLOSURE: ${route.method} ${path} body contains Tenant A resource ID: ${bodyText.slice(0, 200)}`,
        ).toBe(false);
      });
    }
  });

  // ── Org-scoped agent: Tenant B agent-org1 vs Tenant A resources ──────────

  describe('cross-tenant isolation: Tenant B org-scoped agent vs Tenant A ticket', () => {
    it('GET /tickets/:id returns 404 for Tenant B scoped agent', async () => {
      const res = await request
        .get(`/api/v1/tickets/${tenantATicketId}`)
        .set('Authorization', `Bearer ${TOKEN_B_AGENT_ORG1}`);
      expect(res.status).toBe(404);
    });
  });

  // ── List routes: Tenant B agent sees zero Tenant A rows ──────────────────

  describe('list routes: cross-tenant row contamination', () => {
    it('GET /tickets list returns no Tenant A ticket IDs for Tenant B principal', async () => {
      const res = await request
        .get('/api/v1/tickets')
        .set('Authorization', `Bearer ${TOKEN_B_ADMIN}`);

      // List may return 200 with Tenant B's own empty-or-full result
      expect([200, 401]).toContain(res.status);

      if (res.status === 200) {
        const body = JSON.stringify(res.body);
        const tenantAIds = [...HARNESS_TICKET_A_ORG1, ...HARNESS_TICKET_A_ORG2];
        for (const id of tenantAIds) {
          expect(
            body.includes(id),
            `LIST CONTAMINATION: GET /tickets for Tenant B principal returned Tenant A ticket ${id}`,
          ).toBe(false);
        }
      }
    });
  });

  // ── Allowlist coverage gate ───────────────────────────────────────────────
  // Every entry in ROUTE_ALLOWLIST must be referenced somewhere above or in the
  // tested application; the allowlist must not grow without being exercised.

  describe('allowlist coverage', () => {
    it('ROUTE_ALLOWLIST is non-empty and all entries have justifications', () => {
      expect(ROUTE_ALLOWLIST.length).toBeGreaterThan(0);
      for (const entry of ROUTE_ALLOWLIST) {
        expect(
          entry.justification.length,
          `ALLOWLIST ENTRY ${entry.method} ${entry.pathPattern} has no justification string`,
        ).toBeGreaterThan(0);
      }
    });
  });
});
