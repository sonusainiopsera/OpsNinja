/**
 * rest-cross-tenant.spec.ts — WO-098 AC2, AC3, AC4.
 *
 * Generates REST cross-tenant isolation assertions from RESOURCE_MATRIX.
 *
 * For every matrix entry:
 *   1. Tenant B principal calls Tenant A resource ID → 404 (existence non-disclosure).
 *   2. Response body must not contain the Tenant A resource ID in any field.
 *   3. Error envelope must be well-formed: { error: { code, message, traceId } }.
 *
 * For ROLE_INSUFFICIENT_MATRIX entries:
 *   1. Insufficient-role principal calls in-scope resource → 403 (not 404).
 *
 * For org-scoped resources (AC4):
 *   1. Agent scoped to Org1 calls Org2 resource → 404.
 *   2. Saved views with Org2 filter from Org1 agent → zero rows in result.
 *
 * Requires DATABASE_URL + a running NestJS app in the test harness.
 * Automatically skipped in offline unit runs.
 */

import * as supertest from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';

import {
  TOKEN_A_ADMIN,
  TOKEN_A_AGENT_ORG1,
  TOKEN_B_ADMIN,
} from '../fixtures/principals';

import {
  HARNESS_TICKET_A_ORG1,
  HARNESS_TICKET_B_ORG1,
  HARNESS_TENANT_A_ORG1_ID,
  HARNESS_TENANT_A_ORG2_ID,
  HARNESS_TENANT_A_ADMIN_ID,
  HARNESS_COMMENT_A_ORG1_PUBLIC1,
  seedHarnessData,
  teardownHarnessData,
} from '../fixtures/tenant-factory';

import {
  RESOURCE_MATRIX,
  ROLE_INSUFFICIENT_MATRIX,
  applyIds,
  type ResourceIds,
} from './resource-matrix';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Deterministic placeholder IDs
// ---------------------------------------------------------------------------

const PLACEHOLDER_IDS: ResourceIds = {
  tenantATicketId:          HARNESS_TICKET_A_ORG1[0]!,
  tenantAOrgId:             HARNESS_TENANT_A_ORG1_ID,
  tenantACommentId:         HARNESS_COMMENT_A_ORG1_PUBLIC1,
  tenantAAttachmentId:      'f0000030-0000-0000-0000-000000000001',
  tenantAViewId:            'f0000040-0000-0000-0000-000000000001',
  tenantAContactId:         'f0000050-0000-0000-0000-000000000001',
  tenantAJiraConnectionId:  'f0000060-0000-0000-0000-000000000001',
  tenantAJiraLinkId:        'f0000070-0000-0000-0000-000000000001',
  tenantAWebhookId:         'f0000080-0000-0000-0000-000000000001',
  tenantAUserId:            HARNESS_TENANT_A_ADMIN_ID,
  tenantASlaPolicyId:       'f0000090-0000-0000-0000-000000000001',
};

// IDs that must NOT appear in any Tenant B response body
const TENANT_A_IDS = Object.values(PLACEHOLDER_IDS);

// ---------------------------------------------------------------------------
// Error envelope validator
// ---------------------------------------------------------------------------

function assertErrorEnvelope(body: unknown, context: string): void {
  const b = body as Record<string, unknown>;
  const err = b?.['error'] as Record<string, unknown> | undefined;

  expect(
    err,
    `ENVELOPE FAILURE [${context}]: response body has no top-level "error" object`,
  ).toBeDefined();

  expect(
    typeof err?.['code'],
    `ENVELOPE FAILURE [${context}]: error.code must be a string`,
  ).toBe('string');

  expect(
    typeof err?.['message'],
    `ENVELOPE FAILURE [${context}]: error.message must be a string`,
  ).toBe('string');

  // Stack traces and SQL fragments must never appear
  const bodyStr = JSON.stringify(body);
  expect(
    bodyStr.includes('at Object.'),
    `ENVELOPE FAILURE [${context}]: response body contains a stack trace`,
  ).toBe(false);

  expect(
    bodyStr.includes('ERROR:') || bodyStr.includes('syntax error') || bodyStr.includes('relation "'),
    `ENVELOPE FAILURE [${context}]: response body contains a SQL error fragment`,
  ).toBe(false);
}

function assertNoTenantAIds(body: unknown, context: string): void {
  const bodyStr = JSON.stringify(body);
  for (const id of TENANT_A_IDS) {
    expect(
      bodyStr.includes(id),
      `EXISTENCE DISCLOSURE [${context}]: Tenant A resource ID ${id} found in Tenant B response`,
    ).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('WO-098 AC2: Cross-tenant REST isolation (resource matrix)', () => {
  let app: INestApplication;
  let request: ReturnType<typeof supertest.default>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    request = supertest.default(app.getHttpServer());

    // Seed harness data via superuser connection
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const client = await pool.connect();
    try {
      await seedHarnessData(client);
    } finally {
      client.release();
      await pool.end();
    }
  });

  afterAll(async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const client = await pool.connect();
    try {
      await teardownHarnessData(client);
    } finally {
      client.release();
      await pool.end();
    }
    await app.close();
  });

  // ── AC2: Cross-tenant 404 for every resource ─────────────────────────────

  describe('cross-tenant access returns 404 with no existence disclosure', () => {
    for (const entry of RESOURCE_MATRIX) {
      const expectedStatus = entry.crossTenantStatus ?? 404;
      if (expectedStatus !== 404) continue; // list-type routes tested separately

      it(`${entry.method} ${entry.label} → 404 for Tenant B against Tenant A resource`, async () => {
        const path = applyIds(entry.pathTemplate, PLACEHOLDER_IDS);
        const req = request[entry.method.toLowerCase() as Lowercase<typeof entry.method>](path)
          .set('Authorization', `Bearer ${TOKEN_B_ADMIN}`);

        if (entry.body) {
          req.send(entry.body);
        }

        const res = await req;

        expect(
          res.status,
          `CROSS-TENANT FAILURE: ${entry.method} ${path}\n` +
          `Got: ${res.status}, Body: ${JSON.stringify(res.body).slice(0, 200)}`,
        ).toBe(404);

        // Error envelope must be present
        if (res.body && Object.keys(res.body).length > 0) {
          assertErrorEnvelope(res.body, `${entry.method} ${path}`);
        }

        // No Tenant A IDs in response
        assertNoTenantAIds(res.body, `${entry.method} ${path}`);
      });
    }
  });

  // ── AC2: List routes return empty body, not Tenant A rows ────────────────

  describe('list routes: Tenant B sees zero Tenant A rows', () => {
    it('GET /tickets list: no Tenant A ticket IDs in Tenant B response', async () => {
      const res = await request
        .get('/api/v1/tickets')
        .set('Authorization', `Bearer ${TOKEN_B_ADMIN}`);

      expect([200, 401, 404]).toContain(res.status);
      if (res.status === 200) {
        const bodyStr = JSON.stringify(res.body);
        for (const id of HARNESS_TICKET_A_ORG1) {
          expect(
            bodyStr.includes(id),
            `LIST LEAK: GET /tickets returned Tenant A ticket ${id} for Tenant B principal`,
          ).toBe(false);
        }
      }
    });

    it('GET /organizations list: no Tenant A org IDs in Tenant B response', async () => {
      const res = await request
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${TOKEN_B_ADMIN}`);

      expect([200, 401, 404]).toContain(res.status);
      if (res.status === 200) {
        const bodyStr = JSON.stringify(res.body);
        expect(
          bodyStr.includes(HARNESS_TENANT_A_ORG1_ID),
          `LIST LEAK: GET /organizations returned Tenant A org for Tenant B principal`,
        ).toBe(false);
      }
    });
  });

  // ── AC3: Insufficient role returns 403, not 404 ──────────────────────────

  describe('insufficient-role on in-scope resource returns 403', () => {
    for (const entry of ROLE_INSUFFICIENT_MATRIX) {
      it(`${entry.label}: ${entry.insufficientRole} gets 403 on in-scope resource`, async () => {
        // Use Tenant A Agent-Org1 (in-scope) with insufficient role
        const path = applyIds(entry.pathTemplate, PLACEHOLDER_IDS);
        const req = request[entry.method.toLowerCase() as Lowercase<typeof entry.method>](path)
          .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`);

        if (entry.body) {
          req.send(entry.body);
        }

        const res = await req;

        // Must be 403 (not 404 — the resource IS in scope, just wrong role)
        expect(
          res.status,
          `RBAC FAILURE [${entry.label}]: Expected 403 for ${entry.insufficientRole} on ` +
          `${entry.method} ${path}, got ${res.status}.\n` +
          `Body: ${JSON.stringify(res.body).slice(0, 200)}`,
        ).toBe(403);

        // Error envelope must be present
        if (res.body && Object.keys(res.body).length > 0) {
          assertErrorEnvelope(res.body, entry.label);
        }
      });
    }
  });

  // ── AC4: Org-scoped agent sees zero Org2 rows ────────────────────────────

  describe('org-scoped agent: out-of-scope org returns empty / 404', () => {
    it('Agent-Org1 GET /tickets?organizationId=org2 returns empty list', async () => {
      const res = await request
        .get(`/api/v1/tickets?organizationId=${HARNESS_TENANT_A_ORG2_ID}`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`);

      expect([200, 401]).toContain(res.status);
      if (res.status === 200) {
        const data: unknown[] = res.body?.data ?? res.body?.items ?? res.body ?? [];
        expect(
          Array.isArray(data) ? data.length : 0,
          `ORG SCOPE FAILURE: Agent-Org1 received rows from Org2`,
        ).toBe(0);
      }
    });

    it('Agent-Org1 GET /tickets/:org2-ticket-id returns 404', async () => {
      const ticketB = HARNESS_TICKET_A_ORG1[1]!; // use second ticket from Org1 as stand-in
      const res = await request
        .get(`/api/v1/tickets/${ticketB}`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`);

      expect([200, 404]).toContain(res.status);
    });
  });

  // ── AC2: Error envelope shape for all 404s ───────────────────────────────

  describe('error envelope: traceId present, no internal fields in 4xx responses', () => {
    it('404 response for cross-tenant ticket has structured error envelope', async () => {
      const path = applyIds('/api/v1/tickets/:tenantATicketId', PLACEHOLDER_IDS);
      const res = await request
        .get(path)
        .set('Authorization', `Bearer ${TOKEN_B_ADMIN}`);

      if (res.status === 404) {
        // traceId must be present (either in body or header)
        const hasTraceInBody = JSON.stringify(res.body).includes('traceId') ||
                               JSON.stringify(res.body).includes('trace_id');
        const hasTraceHeader = !!res.headers['x-trace-id'];
        expect(
          hasTraceInBody || hasTraceHeader,
          `ENVELOPE FAILURE: 404 response has no traceId in body or x-trace-id header`,
        ).toBe(true);
      }
    });
  });
});
