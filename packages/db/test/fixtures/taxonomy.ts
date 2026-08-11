/**
 * DevOps Category Taxonomy Fixture
 *
 * Provides a canonical three-level DevOps category taxonomy used by
 * queue, dashboard and report tests. All IDs are deterministic UUIDs
 * to allow foreign-key references without lookup queries.
 *
 * Tree:
 *   Pipeline (depth 0)
 *     ├── Jenkins Integration (depth 1)
 *     ├── GitHub Actions (depth 1)
 *     └── Build Failures (depth 1)
 *   Secrets (depth 0)
 *     ├── Vault Access (depth 1)
 *     └── Rotation Failures (depth 1)
 *   Cloud Infrastructure (depth 0)
 *     ├── AWS (depth 1)
 *     │   └── EC2 Instances (depth 2)
 *     └── GCP (depth 1)
 *   Observability (depth 0)
 *     ├── Metrics (depth 1)
 *     ├── Logs (depth 1)
 *     └── Traces (depth 1)
 */

import type postgres from 'postgres';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

export const CATEGORY_IDS = {
  // Root categories
  PIPELINE:            'c0000001-0000-4000-8000-000000000001',
  SECRETS:             'c0000002-0000-4000-8000-000000000001',
  CLOUD_INFRA:         'c0000003-0000-4000-8000-000000000001',
  OBSERVABILITY:       'c0000004-0000-4000-8000-000000000001',
  // Pipeline children
  JENKINS:             'c0000001-0001-4000-8000-000000000001',
  GITHUB_ACTIONS:      'c0000001-0002-4000-8000-000000000001',
  BUILD_FAILURES:      'c0000001-0003-4000-8000-000000000001',
  // Secrets children
  VAULT_ACCESS:        'c0000002-0001-4000-8000-000000000001',
  ROTATION_FAILURES:   'c0000002-0002-4000-8000-000000000001',
  // Cloud Infra children
  AWS:                 'c0000003-0001-4000-8000-000000000001',
  GCP:                 'c0000003-0002-4000-8000-000000000001',
  // AWS grandchild
  EC2_INSTANCES:       'c0000003-0101-4000-8000-000000000001',
  // Observability children
  METRICS:             'c0000004-0001-4000-8000-000000000001',
  LOGS:                'c0000004-0002-4000-8000-000000000001',
  TRACES:              'c0000004-0003-4000-8000-000000000001',
} as const;

export type CategoryId = (typeof CATEGORY_IDS)[keyof typeof CATEGORY_IDS];

// ---------------------------------------------------------------------------
// Fixture rows (ordered: parents before children)
// ---------------------------------------------------------------------------

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  sort_order: number;
  is_active: boolean;
}

const ROWS: CategoryRow[] = [
  // Root nodes
  { id: CATEGORY_IDS.PIPELINE,       parent_id: null,                    name: 'Pipeline',           slug: 'pipeline',          path: 'pipeline',                   depth: 0, sort_order: 0, is_active: true },
  { id: CATEGORY_IDS.SECRETS,        parent_id: null,                    name: 'Secrets',            slug: 'secrets',           path: 'secrets',                    depth: 0, sort_order: 1, is_active: true },
  { id: CATEGORY_IDS.CLOUD_INFRA,    parent_id: null,                    name: 'Cloud Infrastructure', slug: 'cloud-infrastructure', path: 'cloud-infrastructure',  depth: 0, sort_order: 2, is_active: true },
  { id: CATEGORY_IDS.OBSERVABILITY,  parent_id: null,                    name: 'Observability',       slug: 'observability',     path: 'observability',              depth: 0, sort_order: 3, is_active: true },
  // Pipeline children
  { id: CATEGORY_IDS.JENKINS,        parent_id: CATEGORY_IDS.PIPELINE,  name: 'Jenkins Integration', slug: 'jenkins-integration', path: 'pipeline/jenkins-integration', depth: 1, sort_order: 0, is_active: true },
  { id: CATEGORY_IDS.GITHUB_ACTIONS, parent_id: CATEGORY_IDS.PIPELINE,  name: 'GitHub Actions',     slug: 'github-actions',    path: 'pipeline/github-actions',    depth: 1, sort_order: 1, is_active: true },
  { id: CATEGORY_IDS.BUILD_FAILURES, parent_id: CATEGORY_IDS.PIPELINE,  name: 'Build Failures',     slug: 'build-failures',    path: 'pipeline/build-failures',    depth: 1, sort_order: 2, is_active: true },
  // Secrets children
  { id: CATEGORY_IDS.VAULT_ACCESS,   parent_id: CATEGORY_IDS.SECRETS,   name: 'Vault Access',       slug: 'vault-access',      path: 'secrets/vault-access',       depth: 1, sort_order: 0, is_active: true },
  { id: CATEGORY_IDS.ROTATION_FAILURES, parent_id: CATEGORY_IDS.SECRETS, name: 'Rotation Failures', slug: 'rotation-failures', path: 'secrets/rotation-failures',  depth: 1, sort_order: 1, is_active: true },
  // Cloud Infra children
  { id: CATEGORY_IDS.AWS,            parent_id: CATEGORY_IDS.CLOUD_INFRA, name: 'AWS',              slug: 'aws',               path: 'cloud-infrastructure/aws',   depth: 1, sort_order: 0, is_active: true },
  { id: CATEGORY_IDS.GCP,            parent_id: CATEGORY_IDS.CLOUD_INFRA, name: 'GCP',              slug: 'gcp',               path: 'cloud-infrastructure/gcp',   depth: 1, sort_order: 1, is_active: true },
  // AWS grandchild
  { id: CATEGORY_IDS.EC2_INSTANCES,  parent_id: CATEGORY_IDS.AWS,       name: 'EC2 Instances',      slug: 'ec2-instances',     path: 'cloud-infrastructure/aws/ec2-instances', depth: 2, sort_order: 0, is_active: true },
  // Observability children
  { id: CATEGORY_IDS.METRICS,        parent_id: CATEGORY_IDS.OBSERVABILITY, name: 'Metrics',        slug: 'metrics',           path: 'observability/metrics',      depth: 1, sort_order: 0, is_active: true },
  { id: CATEGORY_IDS.LOGS,           parent_id: CATEGORY_IDS.OBSERVABILITY, name: 'Logs',           slug: 'logs',              path: 'observability/logs',         depth: 1, sort_order: 1, is_active: true },
  { id: CATEGORY_IDS.TRACES,         parent_id: CATEGORY_IDS.OBSERVABILITY, name: 'Traces',         slug: 'traces',            path: 'observability/traces',       depth: 1, sort_order: 2, is_active: true },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Inserts the DevOps taxonomy into the database for the given tenant.
 *
 * The function must be called AFTER the tenant row exists (FK constraint).
 * It is idempotent: ON CONFLICT DO NOTHING allows repeated calls in the
 * same test suite.
 *
 * @param sql  postgres.js connection (must be superuser to bypass RLS)
 * @param tenantId  The tenant UUID to scope the fixture to.
 */
export async function loadTaxonomyFixtures(
  sql: ReturnType<typeof postgres>,
  tenantId: string,
): Promise<void> {
  for (const row of ROWS) {
    await sql.unsafe(`
      INSERT INTO categories
        (tenant_id, id, parent_id, name, slug, path, depth, sort_order, is_active)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (tenant_id, id) DO NOTHING
    `, [
      tenantId,
      row.id,
      row.parent_id,
      row.name,
      row.slug,
      row.path,
      row.depth,
      row.sort_order,
      row.is_active,
    ]);
  }
}
