/**
 * Organisation-scope isolation suite — WO-043 AC3.
 *
 * Asserts that an agent scoped to Organisation 1 cannot:
 *   - List tickets from Organisation 2
 *   - Read a specific ticket from Organisation 2 (must get 404, not 403)
 *   - Post a comment on an Org 2 ticket
 *   - Assign an Org 2 ticket
 *   - Resolve an Org 2 ticket
 *
 * Also asserts that queue filter results never include out-of-scope rows
 * even when the filter explicitly names an out-of-scope organisation.
 *
 * Three agent fixtures:
 *   TOKEN_A_AGENT_ORG1  — scoped to org1 only
 *   TOKEN_A_AGENT_ORG2  — scoped to org2 only
 *   TOKEN_A_ADMIN       — tenant-wide admin (verifies positive baseline)
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
  TOKEN_A_AGENT_ORG1,
  TOKEN_A_AGENT_ORG2,
} from '../fixtures/principals';
import {
  HARNESS_TICKET_A_ORG1,
  HARNESS_TICKET_A_ORG2,
  HARNESS_COMMENT_A_ORG1_PUBLIC1,
  HARNESS_TENANT_A_ORG1_ID,
  HARNESS_TENANT_A_ORG2_ID,
  seedHarnessData,
  teardownHarnessData,
} from '../fixtures/tenant-factory';
import { Pool } from 'pg';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

const ORG1_TICKET_ID  = HARNESS_TICKET_A_ORG1[0]!;
const ORG2_TICKET_ID  = HARNESS_TICKET_A_ORG2[0]!;
const ORG1_COMMENT_ID = HARNESS_COMMENT_A_ORG1_PUBLIC1;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('WO-043 AC3: Organisation-scope isolation', () => {
  let app: INestApplication;
  let request: ReturnType<typeof supertest.default>;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const client = await pool.connect();
    try {
      await seedHarnessData(client);
    } finally {
      client.release();
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

  // ── Positive baseline: admin sees both orgs ───────────────────────────────

  describe('admin baseline: tenant-wide access', () => {
    it('admin can read Org 1 ticket', async () => {
      const res = await request
        .get(`/api/v1/tickets/${ORG1_TICKET_ID}`)
        .set('Authorization', `Bearer ${TOKEN_A_ADMIN}`);
      expect(res.status).toBe(200);
    });

    it('admin can read Org 2 ticket', async () => {
      const res = await request
        .get(`/api/v1/tickets/${ORG2_TICKET_ID}`)
        .set('Authorization', `Bearer ${TOKEN_A_ADMIN}`);
      expect(res.status).toBe(200);
    });
  });

  // ── Agent scoped to Org 1 cannot access Org 2 ────────────────────────────

  describe('Agent-Org1: cannot read Org 2 resources', () => {
    it('GET /tickets/:id for Org 2 ticket returns 404 (not 403)', async () => {
      const res = await request
        .get(`/api/v1/tickets/${ORG2_TICKET_ID}`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`);
      expect(
        res.status,
        `SCOPE FAILURE: Agent-Org1 got ${res.status} on Org2 ticket. Expected 404 — ` +
        `403 would disclose the resource exists.`,
      ).toBe(404);
    });

    it('GET /tickets list contains no Org 2 ticket IDs for Agent-Org1', async () => {
      const res = await request
        .get('/api/v1/tickets')
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`);
      expect([200, 401]).toContain(res.status);

      if (res.status === 200) {
        const body = JSON.stringify(res.body);
        for (const id of HARNESS_TICKET_A_ORG2) {
          expect(
            body.includes(id),
            `SCOPE FAILURE: Agent-Org1 list response contains Org2 ticket ${id}`,
          ).toBe(false);
        }
      }
    });

    it('queue with orgId=Org2 filter returns empty list for Agent-Org1', async () => {
      const res = await request
        .get(`/api/v1/tickets?organizationId=${HARNESS_TENANT_A_ORG2_ID}`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`);
      expect([200, 401]).toContain(res.status);

      if (res.status === 200) {
        const data = res.body?.data ?? res.body?.items ?? [];
        expect(
          Array.isArray(data) ? data.length : 0,
          `SCOPE FAILURE: Agent-Org1 queue filtered to Org2 returned ${data.length} row(s). Expected 0.`,
        ).toBe(0);
      }
    });

    it('POST /tickets/:id/comments on Org 2 ticket returns 404', async () => {
      const res = await request
        .post(`/api/v1/tickets/${ORG2_TICKET_ID}/comments`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`)
        .send({ body: 'scope-violation comment', visibility: 'public' });
      expect(res.status).toBe(404);
    });

    it('PATCH /tickets/:id on Org 2 ticket returns 404', async () => {
      const res = await request
        .patch(`/api/v1/tickets/${ORG2_TICKET_ID}`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`)
        .send({ priority: 'P1', version: 1 });
      expect(res.status).toBe(404);
    });

    it('POST /tickets/:id/resolve on Org 2 ticket returns 404', async () => {
      const res = await request
        .post(`/api/v1/tickets/${ORG2_TICKET_ID}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG1}`)
        .send({ version: 1, resolutionNote: 'scope-violation resolve' });
      expect(res.status).toBe(404);
    });
  });

  // ── Agent scoped to Org 2 cannot access Org 1 ────────────────────────────

  describe('Agent-Org2: cannot read Org 1 resources', () => {
    it('GET /tickets/:id for Org 1 ticket returns 404', async () => {
      const res = await request
        .get(`/api/v1/tickets/${ORG1_TICKET_ID}`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG2}`);
      expect(res.status).toBe(404);
    });

    it('GET /tickets list contains no Org 1 ticket IDs for Agent-Org2', async () => {
      const res = await request
        .get('/api/v1/tickets')
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG2}`);
      expect([200, 401]).toContain(res.status);

      if (res.status === 200) {
        const body = JSON.stringify(res.body);
        for (const id of HARNESS_TICKET_A_ORG1) {
          expect(
            body.includes(id),
            `SCOPE FAILURE: Agent-Org2 list response contains Org1 ticket ${id}`,
          ).toBe(false);
        }
      }
    });

    it('queue with orgId=Org1 filter returns empty list for Agent-Org2', async () => {
      const res = await request
        .get(`/api/v1/tickets?organizationId=${HARNESS_TENANT_A_ORG1_ID}`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG2}`);
      expect([200, 401]).toContain(res.status);

      if (res.status === 200) {
        const data = res.body?.data ?? res.body?.items ?? [];
        expect(
          Array.isArray(data) ? data.length : 0,
          `SCOPE FAILURE: Agent-Org2 queue filtered to Org1 returned ${data.length} row(s). Expected 0.`,
        ).toBe(0);
      }
    });

    it('GET /tickets/:id/comments on Org 1 ticket returns 404', async () => {
      const res = await request
        .get(`/api/v1/tickets/${ORG1_TICKET_ID}/comments`)
        .set('Authorization', `Bearer ${TOKEN_A_AGENT_ORG2}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Scope predicate unit tests (no DB required) ───────────────────────────

  describe('scope predicate logic (unit, DB-independent)', () => {
    it('agent with empty orgScopeIds cannot see any org', () => {
      const { buildOrgScopePredicate } = require('../../src/data/scope-predicate');
      const stubCol = { name: 'organization_id', table: { name: 'tickets' } };
      const principal = {
        tenantId: 't1',
        userId: 'u1',
        principalKind: 'staff' as const,
        roles: ['agent'],
        orgScopeIds: [] as string[],
        traceId: 'tr1',
      };
      const pred = buildOrgScopePredicate(principal, stubCol as never);
      expect(String(pred)).toContain('false');
    });

    it('admin role bypasses org scope (returns null predicate)', () => {
      const { buildOrgScopePredicate } = require('../../src/data/scope-predicate');
      const stubCol = { name: 'organization_id', table: { name: 'tickets' } };
      const principal = {
        tenantId: 't1',
        userId: 'u1',
        principalKind: 'staff' as const,
        roles: ['admin'],
        orgScopeIds: [] as string[],
        traceId: 'tr1',
      };
      const pred = buildOrgScopePredicate(principal, stubCol as never);
      expect(pred).toBeNull();
    });
  });
});
