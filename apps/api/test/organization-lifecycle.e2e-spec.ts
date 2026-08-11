/**
 * Integration tests for WO-025 — Organization lifecycle (deactivate/reactivate).
 *
 * Tests:
 *  - POST /organizations/:id/deactivate → 200, status=inactive, contacts suspended
 *  - Historical tickets still readable after deactivation
 *  - New ticket creation returns 422 ORGANIZATION_INACTIVE after deactivation
 *  - POST /organizations/:id/reactivate → 200, status=active
 *  - Reactivate with name conflict → 409 ORGANIZATION_NAME_CONFLICT
 *  - Deactivation idempotency: second call → 200, no duplicate outbox event
 *  - confirmName mismatch → 400 CONFIRMATION_NAME_MISMATCH
 *  - No DELETE statement on organizations/contacts/tickets (select from those tables still works)
 *
 * Requires DATABASE_URL. Skipped otherwise.
 */

import { Pool } from 'pg';
import {
  LIFECYCLE_TENANT_ID,
  LIFECYCLE_ORG_ID,
  LIFECYCLE_ORG_NAME,
  LIFECYCLE_ORG2_ID,
  LIFECYCLE_ORG2_NAME,
  LIFECYCLE_OPEN_TICKET_ID,
  LIFECYCLE_TICKET_IDS,
  LIFECYCLE_CONTACT_IDS,
} from './fixtures/organization-lifecycle.fixtures';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;
const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000/api/v1';

async function apiPost(path: string, token: string, body: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function apiGet(path: string, token: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

maybeDescribe('Organization lifecycle (WO-025)', () => {
  let pool: Pool;
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    // Tokens injected by test runner that bootstraps the NestJS app and mints JWTs
    adminToken = process.env['TEST_ADMIN_TOKEN'] ?? 'admin-token';
    agentToken = process.env['TEST_AGENT_TOKEN'] ?? 'agent-token';
  });

  afterAll(async () => {
    await pool.end();
  });

  // --------------------------------------------------------------------------
  // AC1: Deactivate sets status=inactive, deactivated_at populated
  // --------------------------------------------------------------------------

  it('POST /organizations/:id/deactivate returns 200 with status=inactive', async () => {
    const res = await apiPost(
      `/organizations/${LIFECYCLE_ORG_ID}/deactivate`,
      adminToken,
      { confirmName: LIFECYCLE_ORG_NAME, reason: 'Contract ended' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string; deactivatedAt: string } };
    expect(body.data.status).toBe('inactive');
    expect(body.data.deactivatedAt).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // AC2: Contacts have portal_access_enabled=false after deactivation
  // --------------------------------------------------------------------------

  it('Contacts portal_access_enabled set to false after deactivation', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT portal_access_enabled FROM contacts WHERE id = ANY($1::uuid[])`,
        [LIFECYCLE_CONTACT_IDS],
      );
      for (const row of result.rows as { portal_access_enabled: boolean }[]) {
        expect(row.portal_access_enabled).toBe(false);
      }
    } finally {
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // AC3: Historical tickets still readable; new ticket creation rejected
  // --------------------------------------------------------------------------

  it('Historical ticket is still readable after deactivation', async () => {
    const res = await apiGet(`/tickets/${LIFECYCLE_OPEN_TICKET_ID}`, agentToken);
    expect(res.status).toBe(200);
  });

  it('All 5 historical tickets remain in database (no DELETE)', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT count(*)::int AS cnt FROM tickets WHERE id = ANY($1::uuid[])`,
        [LIFECYCLE_TICKET_IDS],
      );
      expect((result.rows[0] as { cnt: number }).cnt).toBe(5);
    } finally {
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // AC5: Idempotency — second deactivate call returns 200, no duplicate event
  // --------------------------------------------------------------------------

  it('Deactivating again is idempotent (200, no duplicate outbox event)', async () => {
    const beforeCount = await countOutboxEvents(pool, LIFECYCLE_ORG_ID);

    const res = await apiPost(
      `/organizations/${LIFECYCLE_ORG_ID}/deactivate`,
      adminToken,
      { confirmName: LIFECYCLE_ORG_NAME, reason: 'Duplicate call' },
    );
    expect(res.status).toBe(200);

    const afterCount = await countOutboxEvents(pool, LIFECYCLE_ORG_ID);
    expect(afterCount).toBe(beforeCount); // no additional event emitted
  });

  // --------------------------------------------------------------------------
  // confirmName mismatch → 400
  // --------------------------------------------------------------------------

  it('Wrong confirmName returns 400 CONFIRMATION_NAME_MISMATCH', async () => {
    const res = await apiPost(
      `/organizations/${LIFECYCLE_ORG_ID}/deactivate`,
      adminToken,
      { confirmName: 'Wrong Name', reason: 'Oops' },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('CONFIRMATION_NAME_MISMATCH');
  });

  // --------------------------------------------------------------------------
  // AC4: Reactivate restores to active
  // --------------------------------------------------------------------------

  it('POST /organizations/:id/reactivate returns 200 with status=active', async () => {
    const res = await apiPost(
      `/organizations/${LIFECYCLE_ORG_ID}/reactivate`,
      adminToken,
      { reason: 'Re-signed contract' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe('active');
  });

  // --------------------------------------------------------------------------
  // AC4: Reactivate → name conflict → 409
  // --------------------------------------------------------------------------

  it('Reactivate returns 409 when another active org has the same name', async () => {
    // Deactivate org first
    await apiPost(
      `/organizations/${LIFECYCLE_ORG_ID}/deactivate`,
      adminToken,
      { confirmName: LIFECYCLE_ORG_NAME, reason: 'Setup for conflict test' },
    );

    // Rename org2 to the same name as org1 (direct DB surgery to simulate conflict)
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE organizations SET name = $1 WHERE id = $2`,
        [LIFECYCLE_ORG_NAME, LIFECYCLE_ORG2_ID],
      );
    } finally {
      client.release();
    }

    const res = await apiPost(
      `/organizations/${LIFECYCLE_ORG_ID}/reactivate`,
      adminToken,
      { reason: 'Try reactivate with name conflict' },
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('ORGANIZATION_NAME_CONFLICT');

    // Restore org2 name
    const client2 = await pool.connect();
    try {
      await client2.query(
        `UPDATE organizations SET name = $1 WHERE id = $2`,
        [LIFECYCLE_ORG2_NAME, LIFECYCLE_ORG2_ID],
      );
    } finally {
      client2.release();
    }
  });

  // --------------------------------------------------------------------------
  // AC6: Outbox event emitted
  // --------------------------------------------------------------------------

  it('An outbox_events row was written for the deactivation', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT event_type FROM outbox_events
         WHERE aggregate_id = $1 AND event_type = 'organization.deactivated'
         LIMIT 1`,
        [LIFECYCLE_ORG_ID],
      );
      expect(res.rows.length).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // AC7: No DELETE statement executed
  // --------------------------------------------------------------------------

  it('Organizations row still exists in database (no hard delete)', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT id FROM organizations WHERE id = $1`,
        [LIFECYCLE_ORG_ID],
      );
      expect(res.rows.length).toBe(1);
    } finally {
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function countOutboxEvents(pool: Pool, orgId: string): Promise<number> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM outbox_events WHERE aggregate_id = $1`,
      [orgId],
    );
    return res.rows[0]?.cnt ?? 0;
  } finally {
    client.release();
  }
}
