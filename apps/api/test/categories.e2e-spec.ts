/**
 * Categories integration tests.
 *
 * Spins up a PostgreSQL 16 Testcontainer, applies all migrations, then
 * exercises the CategoriesService + CategoriesRepository stack directly
 * (no HTTP layer — controllers are tested separately).
 *
 * Scenarios:
 *  1. Build a 3-level taxonomy via the service.
 *  2. Reparent a mid-level node with multiple descendants; assert all paths/depths.
 *  3. Cycle detection prevents reparenting under a descendant.
 *  4. Depth limit enforcement rejects nodes beyond max levels.
 *  5. Deactivation hides nodes from active selectors; historical paths still resolve.
 *  6. Sibling uniqueness rejects duplicate names within the same parent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from 'testcontainers';
import postgres, { type Sql } from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CategoriesRepository } from '../src/modules/tickets/categories/categories.repository.js';
import { CategoriesService } from '../src/modules/tickets/categories/categories.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../packages/db/migrations');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer;
let sql: Sql;
let repo: CategoriesRepository;
let service: CategoriesService;

const TENANT_ID = 'e0000000-0000-4000-8000-000000000001';

async function applyMigrations(connectionString: string) {
  const migrationSql = postgres(connectionString, { max: 1 });
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const content = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8');
    await migrationSql.unsafe(content);
  }
  await migrationSql.end();
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

  // Seed a tenant row (required by FK)
  await sql.unsafe(`
    INSERT INTO tenants (id, name, plan_tier, is_active)
    VALUES ($1::uuid, 'Test Tenant', 'enterprise', true)
    ON CONFLICT (id) DO NOTHING
  `, [TENANT_ID]);

  repo = new CategoriesRepository();
  service = new CategoriesService(repo, null, { maxLevels: 3 });
}, 120_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

// Set tenant context for each query
async function withTenant<T>(fn: (s: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (txSql) => {
    await txSql.unsafe(`SET LOCAL app.current_tenant = '${TENANT_ID}'`);
    return fn(txSql);
  });
}

// ---------------------------------------------------------------------------
// 1. Build 3-level tree
// ---------------------------------------------------------------------------

describe('Build 3-level taxonomy', () => {
  it('creates root categories', async () => {
    await withTenant(async (s) => {
      await service.create(s, TENANT_ID, { name: 'Pipeline' });
      await service.create(s, TENANT_ID, { name: 'Secrets' });
    });

    const nodes = await withTenant((s) => service.getTree(s, TENANT_ID));
    expect(nodes.some((n) => n.name === 'Pipeline')).toBe(true);
    expect(nodes.some((n) => n.name === 'Secrets')).toBe(true);
  });

  it('creates child categories with correct path and depth', async () => {
    let pipelineId: string;

    await withTenant(async (s) => {
      const pipeline = (await service.getTree(s, TENANT_ID)).find((n) => n.name === 'Pipeline')!;
      pipelineId = pipeline.id;
      await service.create(s, TENANT_ID, { name: 'Jenkins Integration', parentId: pipelineId });
      await service.create(s, TENANT_ID, { name: 'GitHub Actions', parentId: pipelineId });
    });

    const nodes = await withTenant((s) => service.getTree(s, TENANT_ID));
    const jenkins = nodes.find((n) => n.name === 'Jenkins Integration')!;
    expect(jenkins.depth).toBe(1);
    expect(jenkins.path).toBe('pipeline/jenkins-integration');
    expect(jenkins.parentId).toBe(pipelineId!);
  });

  it('creates grandchild category (depth 2)', async () => {
    await withTenant(async (s) => {
      const nodes = await service.getTree(s, TENANT_ID);
      const jenkins = nodes.find((n) => n.name === 'Jenkins Integration')!;
      await service.create(s, TENANT_ID, { name: 'Build Agents', parentId: jenkins.id });
    });

    const nodes = await withTenant((s) => service.getTree(s, TENANT_ID));
    const buildAgents = nodes.find((n) => n.name === 'Build Agents')!;
    expect(buildAgents.depth).toBe(2);
    expect(buildAgents.path).toBe('pipeline/jenkins-integration/build-agents');
  });

  it('rejects creation exceeding max depth', async () => {
    await withTenant(async (s) => {
      const nodes = await service.getTree(s, TENANT_ID);
      const buildAgents = nodes.find((n) => n.name === 'Build Agents')!;
      await expect(
        service.create(s, TENANT_ID, { name: 'Too Deep', parentId: buildAgents.id }),
      ).rejects.toMatchObject({ code: 'CATEGORY_DEPTH_LIMIT' });
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Reparent mid-level node with descendants
// ---------------------------------------------------------------------------

describe('Reparent with descendants', () => {
  it('builds a tree with 20+ nodes and reparents correctly', async () => {
    // Build a subtree of 20 descendants under a dedicated root
    let rootId: string;
    const childIds: string[] = [];

    await withTenant(async (s) => {
      const root = await service.create(s, TENANT_ID, { name: 'ReparentRoot' });
      rootId = root.id;
      const mid = await service.create(s, TENANT_ID, { name: 'MidLevel', parentId: rootId });

      for (let i = 0; i < 10; i++) {
        const child = await service.create(s, TENANT_ID, {
          name: `Child${i}`,
          parentId: mid.id,
        });
        childIds.push(child.id);
      }
    });

    // Create a second root to reparent under
    let newParentId: string;
    await withTenant(async (s) => {
      const newParent = await service.create(s, TENANT_ID, { name: 'NewParent' });
      newParentId = newParent.id;
    });

    // Reparent MidLevel under NewParent
    await withTenant(async (s) => {
      const nodes = await service.getTree(s, TENANT_ID);
      const mid = nodes.find((n) => n.name === 'MidLevel')!;
      await service.reparent(s, TENANT_ID, mid.id, newParentId!);
    });

    // Assert all paths and depths updated
    const nodes = await withTenant((s) => service.getTree(s, TENANT_ID));
    const mid = nodes.find((n) => n.name === 'MidLevel')!;
    expect(mid.depth).toBe(1);
    expect(mid.path).toBe('newparent/midlevel');

    for (const childId of childIds) {
      const child = nodes.find((n) => n.id === childId)!;
      expect(child.depth).toBe(2);
      expect(child.path.startsWith('newparent/midlevel/')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Cycle detection
// ---------------------------------------------------------------------------

describe('Cycle detection', () => {
  it('rejects reparenting a node under its own descendant', async () => {
    let parentId: string;
    let childId: string;

    await withTenant(async (s) => {
      const parent = await service.create(s, TENANT_ID, { name: 'CycleParent' });
      parentId = parent.id;
      const child = await service.create(s, TENANT_ID, { name: 'CycleChild', parentId });
      childId = child.id;
    });

    await withTenant(async (s) => {
      await expect(service.reparent(s, TENANT_ID, parentId!, childId!)).rejects.toMatchObject({
        code: 'CATEGORY_CYCLE',
      });
    });
  });

  it('rejects moving a node under itself', async () => {
    let nodeId: string;
    await withTenant(async (s) => {
      const node = await service.create(s, TENANT_ID, { name: 'SelfRef' });
      nodeId = node.id;
    });

    await withTenant(async (s) => {
      await expect(service.reparent(s, TENANT_ID, nodeId!, nodeId!)).rejects.toMatchObject({
        code: 'CATEGORY_CYCLE',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Deactivation semantics
// ---------------------------------------------------------------------------

describe('Deactivation', () => {
  it('deactivated node is excluded from active selectors', async () => {
    let catId: string;

    await withTenant(async (s) => {
      const cat = await service.create(s, TENANT_ID, { name: 'DeprecatedTool' });
      catId = cat.id;
      await service.deactivate(s, TENANT_ID, catId);
    });

    // Default getTree excludes inactive
    const active = await withTenant((s) => service.getTree(s, TENANT_ID, false));
    expect(active.some((n) => n.id === catId!)).toBe(false);

    // With includeInactive=true it appears
    const all = await withTenant((s) => service.getTree(s, TENANT_ID, true));
    const found = all.find((n) => n.id === catId!);
    expect(found?.isActive).toBe(false);
  });

  it('deactivated node path is still resolvable (historical tickets)', async () => {
    let catId: string;

    await withTenant(async (s) => {
      const cat = await service.create(s, TENANT_ID, { name: 'OldCategory' });
      catId = cat.id;
      await service.deactivate(s, TENANT_ID, catId);
    });

    const all = await withTenant((s) => service.getTree(s, TENANT_ID, true));
    const found = all.find((n) => n.id === catId!);
    expect(found).toBeDefined();
    expect(found?.path).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Sibling uniqueness
// ---------------------------------------------------------------------------

describe('Sibling uniqueness', () => {
  it('rejects duplicate sibling names (case-insensitive)', async () => {
    await withTenant(async (s) => {
      await service.create(s, TENANT_ID, { name: 'UniqueTool' });
      await expect(
        service.create(s, TENANT_ID, { name: 'uniquetool' }),
      ).rejects.toMatchObject({ code: 'CATEGORY_DUPLICATE' });
    });
  });

  it('allows same name under different parents', async () => {
    await withTenant(async (s) => {
      const p1 = await service.create(s, TENANT_ID, { name: 'Vendor1' });
      const p2 = await service.create(s, TENANT_ID, { name: 'Vendor2' });
      await service.create(s, TENANT_ID, { name: 'Billing', parentId: p1.id });
      // Should NOT throw
      await service.create(s, TENANT_ID, { name: 'Billing', parentId: p2.id });
    });
  });
});
