/**
 * Anonymised seed fixture for organization registry tests (WO-023).
 *
 * Contains:
 *   - 3 tenants
 *   - 12 organizations (4 per tenant: 3 active, 1 inactive)
 *   - 30 contacts (10 per tenant: ~2-3 per org, mix of portal/non-portal)
 *   - 8 custom field definitions (shared structure, 4 per tenant × 2 tenants + global 4)
 *
 * All data is anonymised — no real company names, emails, or domains.
 * UUIDs are deterministic (v4-format with fixed values) for repeatable tests.
 */

// ---------------------------------------------------------------------------
// Tenant IDs
// ---------------------------------------------------------------------------

export const ORG_SEED_TENANT_A = 'a0000001-0000-0000-0000-000000000001';
export const ORG_SEED_TENANT_B = 'a0000001-0000-0000-0000-000000000002';
export const ORG_SEED_TENANT_C = 'a0000001-0000-0000-0000-000000000003';

export const ORG_SEED_TENANTS = [
  { id: ORG_SEED_TENANT_A, name: 'Alpha Corp', slug: 'alpha-corp' },
  { id: ORG_SEED_TENANT_B, name: 'Beta Ltd', slug: 'beta-ltd' },
  { id: ORG_SEED_TENANT_C, name: 'Gamma Inc', slug: 'gamma-inc' },
];

// ---------------------------------------------------------------------------
// Organizations (4 per tenant: 3 active, 1 inactive)
// ---------------------------------------------------------------------------

export interface SeedOrganization {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  slaTier: string;
  region: string;
  status: 'active' | 'inactive';
  customFieldValues: Record<string, unknown>;
}

export const ORG_SEED_ORGS: SeedOrganization[] = [
  // Tenant A
  { id: 'a0000002-0000-0000-0000-000000000001', tenantId: ORG_SEED_TENANT_A, name: 'Acme Solutions', slug: 'acme-solutions', slaTier: 'premium', region: 'us-east-1', status: 'active', customFieldValues: { cloud_provider: 'aws', tier_notes: '' } },
  { id: 'a0000002-0000-0000-0000-000000000002', tenantId: ORG_SEED_TENANT_A, name: 'Pinnacle Systems', slug: 'pinnacle-systems', slaTier: 'standard', region: 'us-west-2', status: 'active', customFieldValues: {} },
  { id: 'a0000002-0000-0000-0000-000000000003', tenantId: ORG_SEED_TENANT_A, name: 'Vertex Tech', slug: 'vertex-tech', slaTier: 'enterprise', region: 'eu-west-1', status: 'active', customFieldValues: { cloud_provider: 'gcp' } },
  { id: 'a0000002-0000-0000-0000-000000000004', tenantId: ORG_SEED_TENANT_A, name: 'Old Horizon', slug: 'old-horizon', slaTier: 'standard', region: 'us-east-1', status: 'inactive', customFieldValues: {} },
  // Tenant B
  { id: 'a0000002-0000-0000-0000-000000000005', tenantId: ORG_SEED_TENANT_B, name: 'Nexus Global', slug: 'nexus-global', slaTier: 'premium', region: 'ap-southeast-1', status: 'active', customFieldValues: { cloud_provider: 'azure' } },
  { id: 'a0000002-0000-0000-0000-000000000006', tenantId: ORG_SEED_TENANT_B, name: 'Summit Analytics', slug: 'summit-analytics', slaTier: 'standard', region: 'eu-central-1', status: 'active', customFieldValues: {} },
  { id: 'a0000002-0000-0000-0000-000000000007', tenantId: ORG_SEED_TENANT_B, name: 'Meridian Group', slug: 'meridian-group', slaTier: 'enterprise', region: 'us-east-1', status: 'active', customFieldValues: { cloud_provider: 'aws', soc2: true } },
  { id: 'a0000002-0000-0000-0000-000000000008', tenantId: ORG_SEED_TENANT_B, name: 'Archived Co', slug: 'archived-co', slaTier: 'standard', region: 'us-west-2', status: 'inactive', customFieldValues: {} },
  // Tenant C
  { id: 'a0000002-0000-0000-0000-000000000009', tenantId: ORG_SEED_TENANT_C, name: 'Cobalt Dynamics', slug: 'cobalt-dynamics', slaTier: 'premium', region: 'us-east-1', status: 'active', customFieldValues: {} },
  { id: 'a0000002-0000-0000-0000-000000000010', tenantId: ORG_SEED_TENANT_C, name: 'Titan Services', slug: 'titan-services', slaTier: 'standard', region: 'eu-west-1', status: 'active', customFieldValues: { cloud_provider: 'aws' } },
  { id: 'a0000002-0000-0000-0000-000000000011', tenantId: ORG_SEED_TENANT_C, name: 'Radiant Corp', slug: 'radiant-corp', slaTier: 'enterprise', region: 'us-west-2', status: 'active', customFieldValues: {} },
  { id: 'a0000002-0000-0000-0000-000000000012', tenantId: ORG_SEED_TENANT_C, name: 'Legacy Ops', slug: 'legacy-ops', slaTier: 'standard', region: 'ap-southeast-1', status: 'inactive', customFieldValues: {} },
];

// Helpers for quick lookup
export const ORG_SEED_ORGS_BY_TENANT: Record<string, SeedOrganization[]> = {
  [ORG_SEED_TENANT_A]: ORG_SEED_ORGS.filter((o) => o.tenantId === ORG_SEED_TENANT_A),
  [ORG_SEED_TENANT_B]: ORG_SEED_ORGS.filter((o) => o.tenantId === ORG_SEED_TENANT_B),
  [ORG_SEED_TENANT_C]: ORG_SEED_ORGS.filter((o) => o.tenantId === ORG_SEED_TENANT_C),
};

// ---------------------------------------------------------------------------
// Contacts (10 per tenant = 30 total)
// ---------------------------------------------------------------------------

export interface SeedContact {
  id: string;
  tenantId: string;
  organizationId: string;
  email: string;
  fullName: string;
  jobTitle: string | null;
  portalAccessEnabled: boolean;
  status: 'active' | 'inactive';
}

export const ORG_SEED_CONTACTS: SeedContact[] = [
  // Tenant A — 10 contacts
  { id: 'a0000003-0000-0000-0000-000000000001', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000001', email: 'alice@acme-solutions.example', fullName: 'Alice Chen', jobTitle: 'CTO', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000002', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000001', email: 'bob@acme-solutions.example', fullName: 'Bob Smith', jobTitle: 'Engineering Lead', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000003', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000001', email: 'carol@acme-solutions.example', fullName: 'Carol Jones', jobTitle: null, portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000004', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000002', email: 'dan@pinnacle.example', fullName: 'Dan Lee', jobTitle: 'VP Operations', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000005', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000002', email: 'eve@pinnacle.example', fullName: 'Eve Park', jobTitle: 'DevOps Manager', portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000006', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000003', email: 'frank@vertex.example', fullName: 'Frank Nguyen', jobTitle: 'CEO', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000007', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000003', email: 'grace@vertex.example', fullName: 'Grace Kim', jobTitle: null, portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000008', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000004', email: 'hank@old-horizon.example', fullName: 'Hank Turner', jobTitle: 'IT Director', portalAccessEnabled: false, status: 'inactive' },
  { id: 'a0000003-0000-0000-0000-000000000009', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000001', email: 'irene@acme-solutions.example', fullName: 'Irene Walsh', jobTitle: 'Support Lead', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000010', tenantId: ORG_SEED_TENANT_A, organizationId: 'a0000002-0000-0000-0000-000000000002', email: 'jack@pinnacle.example', fullName: 'Jack Brown', jobTitle: null, portalAccessEnabled: false, status: 'active' },

  // Tenant B — 10 contacts
  { id: 'a0000003-0000-0000-0000-000000000011', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000005', email: 'kate@nexus.example', fullName: 'Kate Williams', jobTitle: 'CTO', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000012', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000005', email: 'liam@nexus.example', fullName: 'Liam Davis', jobTitle: 'Cloud Architect', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000013', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000005', email: 'mia@nexus.example', fullName: 'Mia Robinson', jobTitle: null, portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000014', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000006', email: 'noah@summit.example', fullName: 'Noah Clark', jobTitle: 'COO', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000015', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000006', email: 'olivia@summit.example', fullName: 'Olivia Hall', jobTitle: 'Product Manager', portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000016', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000007', email: 'peter@meridian.example', fullName: 'Peter Lewis', jobTitle: 'VP Engineering', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000017', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000007', email: 'quinn@meridian.example', fullName: 'Quinn Martinez', jobTitle: 'CISO', portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000018', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000007', email: 'rachel@meridian.example', fullName: 'Rachel Young', jobTitle: null, portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000019', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000008', email: 'sam@archived-co.example', fullName: 'Sam King', jobTitle: 'CTO', portalAccessEnabled: false, status: 'inactive' },
  { id: 'a0000003-0000-0000-0000-000000000020', tenantId: ORG_SEED_TENANT_B, organizationId: 'a0000002-0000-0000-0000-000000000006', email: 'tina@summit.example', fullName: 'Tina Anderson', jobTitle: 'Operations', portalAccessEnabled: true, status: 'active' },

  // Tenant C — 10 contacts
  { id: 'a0000003-0000-0000-0000-000000000021', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000009', email: 'uma@cobalt.example', fullName: 'Uma Thomas', jobTitle: 'CTO', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000022', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000009', email: 'victor@cobalt.example', fullName: 'Victor Jackson', jobTitle: 'Head of Platform', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000023', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000009', email: 'wendy@cobalt.example', fullName: 'Wendy Harris', jobTitle: null, portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000024', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000010', email: 'xander@titan.example', fullName: 'Xander White', jobTitle: 'IT Manager', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000025', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000010', email: 'yasmin@titan.example', fullName: 'Yasmin Moore', jobTitle: 'Cloud Engineer', portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000026', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000011', email: 'zach@radiant.example', fullName: 'Zach Taylor', jobTitle: 'CEO', portalAccessEnabled: true, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000027', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000011', email: 'amy@radiant.example', fullName: 'Amy Thompson', jobTitle: 'DevOps', portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000028', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000011', email: 'ben@radiant.example', fullName: 'Ben Garcia', jobTitle: null, portalAccessEnabled: false, status: 'active' },
  { id: 'a0000003-0000-0000-0000-000000000029', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000012', email: 'chloe@legacy.example', fullName: 'Chloe Martinez', jobTitle: 'VP Ops', portalAccessEnabled: false, status: 'inactive' },
  { id: 'a0000003-0000-0000-0000-000000000030', tenantId: ORG_SEED_TENANT_C, organizationId: 'a0000002-0000-0000-0000-000000000009', email: 'dave@cobalt.example', fullName: 'Dave Wilson', jobTitle: 'Support Lead', portalAccessEnabled: true, status: 'active' },
];

// ---------------------------------------------------------------------------
// Custom field definitions (8 total: 4 for tenant A, 4 for tenant B)
// ---------------------------------------------------------------------------

export interface SeedCustomFieldDef {
  id: string;
  tenantId: string;
  fieldKey: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'single_select' | 'multi_select';
  options: string[] | null;
  required: boolean;
  appliesTo: string;
  displayOrder: number;
}

export const ORG_SEED_CUSTOM_FIELD_DEFS: SeedCustomFieldDef[] = [
  // Tenant A
  { id: 'a0000004-0000-0000-0000-000000000001', tenantId: ORG_SEED_TENANT_A, fieldKey: 'cloud_provider', label: 'Cloud Provider', dataType: 'single_select', options: ['aws', 'gcp', 'azure', 'on-prem'], required: false, appliesTo: 'organization', displayOrder: 1 },
  { id: 'a0000004-0000-0000-0000-000000000002', tenantId: ORG_SEED_TENANT_A, fieldKey: 'soc2_certified', label: 'SOC2 Certified', dataType: 'boolean', options: null, required: false, appliesTo: 'organization', displayOrder: 2 },
  { id: 'a0000004-0000-0000-0000-000000000003', tenantId: ORG_SEED_TENANT_A, fieldKey: 'employee_count', label: 'Employee Count', dataType: 'number', options: null, required: false, appliesTo: 'organization', displayOrder: 3 },
  { id: 'a0000004-0000-0000-0000-000000000004', tenantId: ORG_SEED_TENANT_A, fieldKey: 'tier_notes', label: 'Tier Notes', dataType: 'string', options: null, required: false, appliesTo: 'organization', displayOrder: 4 },
  // Tenant B
  { id: 'a0000004-0000-0000-0000-000000000005', tenantId: ORG_SEED_TENANT_B, fieldKey: 'cloud_provider', label: 'Cloud Platform', dataType: 'single_select', options: ['aws', 'gcp', 'azure'], required: true, appliesTo: 'organization', displayOrder: 1 },
  { id: 'a0000004-0000-0000-0000-000000000006', tenantId: ORG_SEED_TENANT_B, fieldKey: 'soc2', label: 'SOC 2 Type II', dataType: 'boolean', options: null, required: false, appliesTo: 'organization', displayOrder: 2 },
  { id: 'a0000004-0000-0000-0000-000000000007', tenantId: ORG_SEED_TENANT_B, fieldKey: 'region_list', label: 'Active Regions', dataType: 'multi_select', options: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'], required: false, appliesTo: 'organization', displayOrder: 3 },
  { id: 'a0000004-0000-0000-0000-000000000008', tenantId: ORG_SEED_TENANT_B, fieldKey: 'renewal_date', label: 'Contract Renewal Date', dataType: 'date', options: null, required: false, appliesTo: 'organization', displayOrder: 4 },
];

// ---------------------------------------------------------------------------
// Pagination-boundary tenant (Tenant D)
//
// A dedicated tenant with 105 organisations used to test cursor-pagination
// behaviour at the page boundary (default limit=25, hard cap=100).
//
// Having 105 organisations means:
//   - page 1 (limit=100): returns 100 rows + nextCursor
//   - page 2 (limit=100): returns 5 rows + nextCursor=null
//   - page 1 (limit=25): returns 25 rows + nextCursor
//   - pages 2..4 (limit=25): returns 25, 25, 25 rows + nextCursor
//   - page 5 (limit=25): returns 5 rows + nextCursor=null
//
// All orgs share the same slaTier / region mix so filter tests can isolate
// a subset and verify cursor stability across filtered result sets.
// ---------------------------------------------------------------------------

/** Tenant D — used exclusively for pagination boundary testing. */
export const ORG_SEED_TENANT_D = 'a0000001-0000-0000-0000-000000000004';

export const ORG_SEED_PAGINATION_TENANTS = [
  { id: ORG_SEED_TENANT_D, name: 'Delta Pagination Corp', slug: 'delta-pagination-corp' },
];

/** SLA tiers rotated across pagination orgs to support filter tests. */
const PAGING_TIERS = ['standard', 'premium', 'enterprise'] as const;
/** Regions rotated across pagination orgs. */
const PAGING_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1'] as const;

/**
 * 105 organizations in Tenant D.
 *
 * IDs use the prefix a0000002-0000-0000-0001-{14-digit-zero-padded-seq}.
 * createdAt is staggered 1 second apart (starting 2025-01-01T00:00:00Z)
 * so keyset pagination produces a stable, deterministic ordering.
 *
 * Naming convention:
 *   "Paging Org {N:001..105}"
 * so prefix-search tests can match a subset (e.g. q="Paging Org 0" matches 009 orgs).
 */
function makePagingOrg(n: number): SeedOrganization {
  const seq = String(n).padStart(3, '0');
  const tier = PAGING_TIERS[(n - 1) % PAGING_TIERS.length]!;
  const region = PAGING_REGIONS[(n - 1) % PAGING_REGIONS.length]!;
  // IDs: a0000002-0000-0000-0001-0000000{seq} where seq is zero-padded to 6 digits
  const seqPadded = String(n).padStart(6, '0');
  return {
    id: `a0000002-0000-0000-0001-000000${seqPadded}`,
    tenantId: ORG_SEED_TENANT_D,
    name: `Paging Org ${seq}`,
    slug: `paging-org-${seq}`,
    slaTier: tier,
    region,
    status: 'active',
    customFieldValues: {},
  };
}

/** All 105 pagination-boundary organizations for Tenant D. */
export const ORG_SEED_PAGING_ORGS: SeedOrganization[] = Array.from(
  { length: 105 },
  (_, i) => makePagingOrg(i + 1),
);

/**
 * Combined seed: all organizations across all tenants (A, B, C) plus the
 * 105 pagination orgs in Tenant D.
 *
 * NOTE: Use ORG_SEED_ORGS when you only want the 12 small-fixture orgs,
 * and ORG_SEED_PAGING_ORGS when you only want the Tenant D pagination set.
 * Use ORG_SEED_ALL_ORGS when you need both populations loaded together.
 */
export const ORG_SEED_ALL_ORGS: SeedOrganization[] = [
  ...ORG_SEED_ORGS,
  ...ORG_SEED_PAGING_ORGS,
];

// Helpers for lookup
export const ORG_SEED_PAGING_ORGS_STANDARD = ORG_SEED_PAGING_ORGS.filter((o) => o.slaTier === 'standard');
export const ORG_SEED_PAGING_ORGS_PREMIUM  = ORG_SEED_PAGING_ORGS.filter((o) => o.slaTier === 'premium');
export const ORG_SEED_PAGING_ORGS_ENTERPRISE = ORG_SEED_PAGING_ORGS.filter((o) => o.slaTier === 'enterprise');
