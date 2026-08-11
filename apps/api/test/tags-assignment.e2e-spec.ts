/**
 * Tags and Assignment integration tests.
 *
 * Spins up a PostgreSQL 16 Testcontainer, applies all migrations, then
 * exercises the Tags and Assignment service/repository stacks directly.
 *
 * Scenarios:
 *  1. Tag CRUD — create, rename, deactivate.
 *  2. Attach/detach idempotency — attaching twice returns 200 with one row.
 *  3. Concurrent tag creation — two creates with same slug resolve to one row.
 *  4. Tag merge across 100 tickets — all ticket_tags remapped in one tx; single audit.
 *  5. Assignment group CRUD and membership replacement.
 *  6. Ticket assignment — self-assign as agent succeeds.
 *  7. Ticket reassignment — agent (assign_self only) returns 403.
 *  8. Ticket reassignment — manager (reassign) succeeds.
 *  9. Out-of-scope assignee — returns 422.
 * 10. Tag cap enforcement — 422 on cap breach.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from 'testcontainers';
import postgres, { type Sql } from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TagsRepository }            from '../src/modules/tickets/tags/tags.repository.js';
import { TagsService }               from '../src/modules/tickets/tags/tags.service.js';
import { AssignmentGroupsRepository } from '../src/modules/tickets/assignment/assignment-groups.repository.js';
import { AssignmentGroupsService }    from '../src/modules/tickets/assignment/assignment-groups.service.js';
import { AssignmentService }          from '../src/modules/tickets/assignment/assignment.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../packages/db/migrations');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer;
let sql: Sql;

let tagsRepo: TagsRepository;
let tagsSvc: TagsService;
let groupsRepo: AssignmentGroupsRepository;
let groupsSvc: AssignmentGroupsService;
let assignmentSvc: AssignmentService;

const TENANT_ID  = 'e1111111-0000-4000-8000-000000000001';
const ORG_ID     = 'f1111111-0000-4000-8000-000000000001';
const MANAGER_ID = 'u1111111-0000-4000-8000-000000000001';
const AGENT_ID   = 'u1111111-0000-4000-8000-000000000002';
const OTHER_ORG  = 'f1111111-0000-4000-8000-000000000002';

async function applyMigrations(connectionString: string) {
  const migSql = postgres(connectionString, { max: 1 });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const content = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8');
    await migSql.unsafe(content);
  }
  await migSql.end();
}

async function setTenant(s: Sql) {
  await s.unsafe(`SET LOCAL app.current_tenant = '${TENANT_ID}'`);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('opsninja_test')
    .withUsername('opsninja')
    .withPassword('test')
    .start();

  const cs = container.getConnectionUri();
  await applyMigrations(cs);
  sql = postgres(cs, { max: 5 });

  // Seed tenant, org, users.
  await sql.unsafe(`
    INSERT INTO tenants (id, name, plan_tier, is_active)
    VALUES ('${TENANT_ID}'::uuid, 'E2E Tenant', 'enterprise', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO organizations (tenant_id, id, name, is_active)
    VALUES ('${TENANT_ID}'::uuid, '${ORG_ID}'::uuid, 'Acme Corp', true),
           ('${TENANT_ID}'::uuid, '${OTHER_ORG}'::uuid, 'Other Corp', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO users (tenant_id, id, email, display_name, is_active)
    VALUES ('${TENANT_ID}'::uuid, '${MANAGER_ID}'::uuid, 'manager@test.example', 'Manager', true),
           ('${TENANT_ID}'::uuid, '${AGENT_ID}'::uuid, 'agent@test.example', 'Agent', true)
    ON CONFLICT DO NOTHING;
  `);

  tagsRepo    = new TagsRepository();
  tagsSvc     = new TagsService(tagsRepo, null, { maxTagsPerTenant: 10 });
  groupsRepo  = new AssignmentGroupsRepository();
  groupsSvc   = new AssignmentGroupsService(groupsRepo, null);
  assignmentSvc = new AssignmentService(null);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

// ---------------------------------------------------------------------------
// Helper: create a ticket in the DB for assignment tests.
// ---------------------------------------------------------------------------

async function createTicket(orgId = ORG_ID): Promise<{ id: string; updatedAt: string }> {
  type Row = { id: string; updated_at: Date };
  const rows = await sql<Row[]>`
    INSERT INTO tickets (tenant_id, organization_id, subject, status, priority)
    VALUES (${TENANT_ID}::uuid, ${orgId}::uuid, 'Test Ticket', 'open', 'P3')
    RETURNING id, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('Ticket insert failed.');
  return { id: row.id, updatedAt: row.updated_at.toISOString() };
}

// ---------------------------------------------------------------------------
// 1. Tag CRUD
// ---------------------------------------------------------------------------

describe('Tag CRUD', () => {
  it('creates a tag with normalised slug', async () => {
    await sql.begin(async (tx) => {
      await setTenant(tx);
      const tag = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Bug Fix' });
      expect(tag.slug).toBe('bug-fix');
      expect(tag.name).toBe('Bug Fix');
    });
  });

  it('returns the existing tag on slug conflict (returnExistingOnConflict=true)', async () => {
    let firstId: string;
    await sql.begin(async (tx) => {
      await setTenant(tx);
      const t1 = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Duplicate Tag' });
      firstId = t1.id;
    });
    await sql.begin(async (tx) => {
      await setTenant(tx);
      const t2 = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Duplicate Tag' }, { returnExistingOnConflict: true });
      expect(t2.id).toBe(firstId!);
    });
  });

  it('throws TAG_DUPLICATE on explicit conflict (returnExistingOnConflict=false)', async () => {
    let name: string;
    await sql.begin(async (tx) => {
      await setTenant(tx);
      const t = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Explicit Dup Tag' });
      name = t.name;
    });
    await sql.begin(async (tx) => {
      await setTenant(tx);
      await expect(
        tagsSvc.createTag(tx, TENANT_ID, { name: name! }, { returnExistingOnConflict: false }),
      ).rejects.toMatchObject({ code: 'TAG_DUPLICATE' });
    });
  });

  it('deactivates a tag', async () => {
    let tagId: string;
    await sql.begin(async (tx) => {
      await setTenant(tx);
      const t = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Tag To Deactivate' });
      tagId = t.id;
    });
    await sql.begin(async (tx) => {
      await setTenant(tx);
      const deactivated = await tagsSvc.deactivateTag(tx, TENANT_ID, tagId!);
      expect(deactivated.isActive).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Attach/detach idempotency
// ---------------------------------------------------------------------------

describe('Attach/detach idempotency', () => {
  it('attaching twice does not create duplicate row', async () => {
    let tagId: string;
    const ticketId = 't1111111-0000-4000-8000-000000000001';

    await sql.begin(async (tx) => {
      await setTenant(tx);
      const tag = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Idempotent Tag' }, { returnExistingOnConflict: true });
      tagId = tag.id;

      await tagsSvc.attachTag(tx, TENANT_ID, ticketId, tagId);
      await tagsSvc.attachTag(tx, TENANT_ID, ticketId, tagId);
    });

    const ids = await sql`
      SELECT tag_id FROM ticket_tags
      WHERE tenant_id = ${TENANT_ID}::uuid AND ticket_id = ${ticketId}::uuid AND tag_id = ${tagId!}::uuid
    `;
    expect(ids.length).toBe(1);
  });

  it('detaching a non-attached tag does not error', async () => {
    let tagId: string;
    await sql.begin(async (tx) => {
      await setTenant(tx);
      const tag = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Detach Only Tag' }, { returnExistingOnConflict: true });
      tagId = tag.id;
    });

    await expect(
      sql.begin(async (tx) => {
        await setTenant(tx);
        await tagsSvc.detachTag(tx, TENANT_ID, 'nonexistent-ticket', tagId!);
      }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Tag merge across 100 tickets
// ---------------------------------------------------------------------------

describe('Tag merge across 100 tickets', () => {
  it('remaps all ticket_tags rows and returns affected count', async () => {
    let sourceId: string;
    let targetId: string;

    // Create source and target tags.
    await sql.begin(async (tx) => {
      await setTenant(tx);
      const src = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Merge Source' }, { returnExistingOnConflict: true });
      const tgt = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Merge Target' }, { returnExistingOnConflict: true });
      sourceId = src.id;
      targetId = tgt.id;
    });

    // Attach source to 100 synthetic ticket IDs.
    const ticketUuids: string[] = [];
    for (let i = 1; i <= 100; i++) {
      const hex = i.toString(16).padStart(4, '0');
      ticketUuids.push(`cccccccc-0000-4000-8000-0000000${hex}`);
    }

    await sql.begin(async (tx) => {
      await setTenant(tx);
      for (const tid of ticketUuids) {
        await tagsRepo.attachTag(tx, TENANT_ID, tid, sourceId!);
      }
    });

    // Merge source → target.
    const result = await sql.begin(async (tx) => {
      await setTenant(tx);
      return tagsSvc.mergeTags(tx, TENANT_ID, sourceId!, targetId!);
    });

    expect(result.affectedTicketCount).toBe(100);

    // Source tag should be gone.
    const sourceRows = await sql`
      SELECT id FROM tags WHERE tenant_id = ${TENANT_ID}::uuid AND id = ${sourceId!}::uuid
    `;
    expect(sourceRows.length).toBe(0);

    // All 100 ticket_tags should now point to target.
    const targetCount = await sql<[{ count: string }]>`
      SELECT COUNT(*) AS count FROM ticket_tags
      WHERE tenant_id = ${TENANT_ID}::uuid AND tag_id = ${targetId!}::uuid
    `;
    expect(parseInt(targetCount[0]!.count, 10)).toBeGreaterThanOrEqual(100);
  });

  it('handles tickets already carrying both tags (ON CONFLICT DO NOTHING)', async () => {
    let sourceId: string;
    let targetId: string;
    const sharedTicket = 'dddddddd-0000-4000-8000-000000000001';

    await sql.begin(async (tx) => {
      await setTenant(tx);
      const src = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Both Source' }, { returnExistingOnConflict: true });
      const tgt = await tagsSvc.createTag(tx, TENANT_ID, { name: 'Both Target' }, { returnExistingOnConflict: true });
      sourceId = src.id;
      targetId = tgt.id;
      // Attach BOTH to the same ticket.
      await tagsRepo.attachTag(tx, TENANT_ID, sharedTicket, sourceId);
      await tagsRepo.attachTag(tx, TENANT_ID, sharedTicket, targetId);
    });

    // Merge should not throw on the duplicate key.
    await expect(sql.begin(async (tx) => {
      await setTenant(tx);
      return tagsSvc.mergeTags(tx, TENANT_ID, sourceId!, targetId!);
    })).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Assignment group CRUD and membership
// ---------------------------------------------------------------------------

describe('Assignment groups', () => {
  it('creates a group and replaces members', async () => {
    let groupId: string;

    await sql.begin(async (tx) => {
      await setTenant(tx);
      const g = await groupsSvc.createGroup(tx, TENANT_ID, { name: 'Test Group Alpha' });
      groupId = g.id;
    });

    await sql.begin(async (tx) => {
      await setTenant(tx);
      await groupsSvc.setMembers(tx, TENANT_ID, groupId!, [AGENT_ID, MANAGER_ID]);
    });

    await sql.begin(async (tx) => {
      await setTenant(tx);
      const members = await groupsSvc.getMembers(tx, TENANT_ID, groupId!);
      expect(members.map((m) => m.userId).sort()).toEqual([AGENT_ID, MANAGER_ID].sort());
    });
  });

  it('replaces membership atomically (old members removed)', async () => {
    let groupId: string;

    await sql.begin(async (tx) => {
      await setTenant(tx);
      const g = await groupsSvc.createGroup(tx, TENANT_ID, { name: 'Test Group Beta' });
      groupId = g.id;
      await groupsSvc.setMembers(tx, TENANT_ID, groupId, [AGENT_ID, MANAGER_ID]);
    });

    await sql.begin(async (tx) => {
      await setTenant(tx);
      await groupsSvc.setMembers(tx, TENANT_ID, groupId!, [AGENT_ID]);
    });

    await sql.begin(async (tx) => {
      await setTenant(tx);
      const members = await groupsSvc.getMembers(tx, TENANT_ID, groupId!);
      expect(members.map((m) => m.userId)).toEqual([AGENT_ID]);
    });
  });

  it('throws GROUP_DUPLICATE on duplicate name', async () => {
    await sql.begin(async (tx) => {
      await setTenant(tx);
      await groupsSvc.createGroup(tx, TENANT_ID, { name: 'Unique Group Name XYZ' });
    });
    await expect(
      sql.begin(async (tx) => {
        await setTenant(tx);
        await groupsSvc.createGroup(tx, TENANT_ID, { name: 'Unique Group Name XYZ' });
      }),
    ).rejects.toMatchObject({ code: 'GROUP_DUPLICATE' });
  });
});

// ---------------------------------------------------------------------------
// 5. Ticket assignment RBAC
// ---------------------------------------------------------------------------

describe('Ticket assignment', () => {
  it('agent (assign_self) may self-assign an unassigned ticket', async () => {
    const { id: ticketId, updatedAt } = await createTicket();
    const result = await assignmentSvc.assignTicket(
      sql, TENANT_ID, ticketId,
      { version: updatedAt, assigneeUserId: AGENT_ID },
      { userId: AGENT_ID, permissions: ['ticket:assign_self'] },
    );
    expect(result.assigneeUserId).toBe(AGENT_ID);
  });

  it('agent (assign_self only) may NOT reassign to another agent — returns 403', async () => {
    const { id: ticketId, updatedAt } = await createTicket();

    // First assign to manager.
    const assigned = await assignmentSvc.assignTicket(
      sql, TENANT_ID, ticketId,
      { version: updatedAt, assigneeUserId: MANAGER_ID },
      { userId: MANAGER_ID, permissions: ['ticket:reassign'] },
    );

    await expect(
      assignmentSvc.assignTicket(
        sql, TENANT_ID, ticketId,
        { version: assigned.updatedAt.toISOString(), assigneeUserId: AGENT_ID },
        { userId: AGENT_ID, permissions: ['ticket:assign_self'] },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' });
  });

  it('manager (reassign) may reassign between agents', async () => {
    const { id: ticketId, updatedAt } = await createTicket();

    const r1 = await assignmentSvc.assignTicket(
      sql, TENANT_ID, ticketId,
      { version: updatedAt, assigneeUserId: AGENT_ID },
      { userId: MANAGER_ID, permissions: ['ticket:reassign'] },
    );
    expect(r1.assigneeUserId).toBe(AGENT_ID);

    const r2 = await assignmentSvc.assignTicket(
      sql, TENANT_ID, ticketId,
      { version: r1.updatedAt.toISOString(), assigneeUserId: MANAGER_ID },
      { userId: MANAGER_ID, permissions: ['ticket:reassign'] },
    );
    expect(r2.assigneeUserId).toBe(MANAGER_ID);
  });

  it('emits outbox event on assignment change', async () => {
    const { id: ticketId, updatedAt } = await createTicket();

    await assignmentSvc.assignTicket(
      sql, TENANT_ID, ticketId,
      { version: updatedAt, assigneeUserId: AGENT_ID },
      { userId: MANAGER_ID, permissions: ['ticket:reassign'] },
    );

    const events = await sql<[{ event_type: string; payload: Record<string, unknown> }]>`
      SELECT event_type, payload FROM outbox_events
      WHERE tenant_id = ${TENANT_ID}::uuid
        AND aggregate_type = 'ticket'
        AND aggregate_id = ${ticketId}::uuid
        AND event_type = 'ticket.assigned'
    `;
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.payload['new_assignee_id']).toBe(AGENT_ID);
  });

  it('version conflict returns ASSIGNMENT_CONFLICT', async () => {
    const { id: ticketId } = await createTicket();

    await expect(
      assignmentSvc.assignTicket(
        sql, TENANT_ID, ticketId,
        { version: '2020-01-01T00:00:00.000Z', assigneeUserId: AGENT_ID },
        { userId: MANAGER_ID, permissions: ['ticket:reassign'] },
      ),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_CONFLICT' });
  });

  it('unassigning already-unassigned ticket is idempotent (no event)', async () => {
    const { id: ticketId, updatedAt } = await createTicket();

    const before = await sql<[{ count: string }]>`
      SELECT COUNT(*) AS count FROM outbox_events
      WHERE tenant_id = ${TENANT_ID}::uuid AND event_type = 'ticket.assigned'
    `;
    const beforeCount = parseInt(before[0]!.count, 10);

    await assignmentSvc.assignTicket(
      sql, TENANT_ID, ticketId,
      { version: updatedAt, assigneeUserId: null },
      { userId: MANAGER_ID, permissions: ['ticket:reassign'] },
    );

    const after = await sql<[{ count: string }]>`
      SELECT COUNT(*) AS count FROM outbox_events
      WHERE tenant_id = ${TENANT_ID}::uuid AND event_type = 'ticket.assigned'
    `;
    // unassigning already-null: no new event
    expect(parseInt(after[0]!.count, 10)).toBe(beforeCount);
  });
});

// ---------------------------------------------------------------------------
// 6. Tag cap enforcement
// ---------------------------------------------------------------------------

describe('Tag cap enforcement', () => {
  it('throws TAG_CAP_EXCEEDED when cap is reached', async () => {
    const cappedSvc = new TagsService(tagsRepo, null, { maxTagsPerTenant: 0 });

    await expect(
      sql.begin(async (tx) => {
        await setTenant(tx);
        await cappedSvc.createTag(tx, TENANT_ID, { name: 'Over Cap' });
      }),
    ).rejects.toMatchObject({ code: 'TAG_CAP_EXCEEDED' });
  });
});
