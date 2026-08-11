/**
 * filter-integration.e2e-spec.ts
 *
 * Integration tests: compiled predicates executed against a seeded test database.
 * Uses pg pool (Testcontainers or TEST_DATABASE_URL env var) to verify that
 * compiled SQL predicates return the expected ticket IDs.
 *
 * Runs with jest-e2e.json which points at this file.
 * Skip if no TEST_DATABASE_URL or TESTCONTAINERS_AVAILABLE env var set.
 */

import {
  parseFilterAst,
  validateFilterAst,
  compileToPredicate,
  computeSignature,
  type FilterAst,
} from '@opsninja/filter-compiler';

const SKIP = !process.env['TEST_DATABASE_URL'] && !process.env['TESTCONTAINERS_AVAILABLE'];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

interface SeedTicket {
  id: string;
  status: string;
  priority: string;
  organizationId: string | null;
  slaState: string | null;
}

const SEED_TICKETS: SeedTicket[] = [
  { id: '11111111-1111-1111-1111-111111111111', status: 'open', priority: 'p1', organizationId: ORG_A, slaState: 'running' },
  { id: '22222222-2222-2222-2222-222222222222', status: 'open', priority: 'p2', organizationId: ORG_A, slaState: 'warning' },
  { id: '33333333-3333-3333-3333-333333333333', status: 'resolved', priority: 'p3', organizationId: ORG_B, slaState: 'breached' },
  { id: '44444444-4444-4444-4444-444444444444', status: 'closed', priority: 'p4', organizationId: null, slaState: null },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function compile(ast: FilterAst): { sql: string; params: unknown[] } {
  const validated = validateFilterAst(ast);
  if (!validated.ok) throw new Error(JSON.stringify(validated.errors));
  return compileToPredicate(validated.ast);
}

// ── Tests (skipped when no database available) ────────────────────────────────

(SKIP ? describe.skip : describe)('Filter integration against seeded database', () => {
  let pool: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> };

  beforeAll(async () => {
    // Lazy import so the test file can be parsed without pg installed in CI
    const { Pool } = await import('pg');
    pool = new Pool({
      connectionString: process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:5432/opsninja_test',
    });

    // Seed test tickets
    for (const t of SEED_TICKETS) {
      await pool.query(
        `INSERT INTO tickets (id, tenant_id, subject, status, priority, organization_id, sla_state, created_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, TENANT_ID, `Test ticket ${t.id}`, t.status, t.priority, t.organizationId, t.slaState, TENANT_ID],
      );
    }
  });

  afterAll(async () => {
    if (pool && 'end' in pool) {
      await (pool as { end(): Promise<void> }).end();
    }
  });

  it('status eq open returns only open tickets', async () => {
    const ast: FilterAst = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
    const { sql, params } = compile(ast);
    const { rows } = await pool.query(`SELECT id FROM tickets WHERE ${sql}`, params);
    const ids = (rows as { id: string }[]).map(r => r.id);
    const expected = SEED_TICKETS.filter(t => t.status === 'open').map(t => t.id);
    expect(ids.sort()).toEqual(expected.sort());
  });

  it('priority in [p1, p2] returns correct tickets', async () => {
    const ast: FilterAst = { type: 'condition', field: 'priority', operator: 'in', value: ['p1', 'p2'] };
    const { sql, params } = compile(ast);
    const { rows } = await pool.query(`SELECT id FROM tickets WHERE ${sql}`, params);
    const ids = (rows as { id: string }[]).map(r => r.id);
    const expected = SEED_TICKETS.filter(t => ['p1', 'p2'].includes(t.priority)).map(t => t.id);
    expect(ids.sort()).toEqual(expected.sort());
  });

  it('AND group: status=open AND organization_id=ORG_A', async () => {
    const ast: FilterAst = {
      type: 'group',
      op: 'and',
      children: [
        { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
        { type: 'condition', field: 'organization_id', operator: 'eq', value: ORG_A },
      ],
    };
    const { sql, params } = compile(ast);
    const { rows } = await pool.query(`SELECT id FROM tickets WHERE ${sql}`, params);
    const ids = (rows as { id: string }[]).map(r => r.id);
    const expected = SEED_TICKETS
      .filter(t => t.status === 'open' && t.organizationId === ORG_A)
      .map(t => t.id);
    expect(ids.sort()).toEqual(expected.sort());
  });

  it('organization_id is_null returns unorganized tickets', async () => {
    const ast: FilterAst = { type: 'condition', field: 'organization_id', operator: 'is_null', value: null };
    const { sql, params } = compile(ast);
    const { rows } = await pool.query(`SELECT id FROM tickets WHERE ${sql}`, params);
    const ids = (rows as { id: string }[]).map(r => r.id);
    const expected = SEED_TICKETS.filter(t => t.organizationId === null).map(t => t.id);
    expect(ids.sort()).toEqual(expected.sort());
  });

  it('sla_state in [warning, breached] returns correct tickets', async () => {
    const ast: FilterAst = {
      type: 'condition',
      field: 'sla_state',
      operator: 'in',
      value: ['warning', 'breached'],
    };
    const { sql, params } = compile(ast);
    const { rows } = await pool.query(`SELECT id FROM tickets WHERE ${sql}`, params);
    const ids = (rows as { id: string }[]).map(r => r.id);
    const expected = SEED_TICKETS
      .filter(t => t.slaState && ['warning', 'breached'].includes(t.slaState))
      .map(t => t.id);
    expect(ids.sort()).toEqual(expected.sort());
  });

  it('empty group compiles to TRUE — returns all tickets', async () => {
    const ast: FilterAst = { type: 'group', op: 'and', children: [] };
    const { sql, params } = compile(ast);
    expect(sql).toBe('TRUE');
    const { rows } = await pool.query(`SELECT id FROM tickets WHERE ${sql}`, params);
    expect((rows as unknown[]).length).toBeGreaterThanOrEqual(SEED_TICKETS.length);
  });

  it('signature is stable for the same filter — suitable as cache key', () => {
    const ast: FilterAst = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
    const sig1 = computeSignature(ast);
    const sig2 = computeSignature(JSON.parse(JSON.stringify(ast)) as FilterAst);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^fc:v\d+:[0-9a-f]{64}$/);
  });
});
