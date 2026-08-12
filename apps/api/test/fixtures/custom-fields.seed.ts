/**
 * Seed fixtures for WO-026 — Custom Field Definitions and Validation.
 *
 * Contains:
 *   - 8 custom field definitions covering all six data types:
 *       string, number, boolean, date, single_select, multi_select
 *   - Organizations with valid metadata (all active definitions satisfied)
 *   - Organizations with legacy metadata (keys from now-archived definitions)
 *   - Organizations with orphan metadata (keys from definitions in another tenant)
 *
 * All data is anonymised. UUIDs are deterministic (fixed v4-format values).
 * Definitions 1–8 all belong to CF_SEED_TENANT, organisations 1–5 also.
 *
 * Definition → data-type map (for quick reference):
 *   cf0000004-0000-0000-0000-000000000001  cloud_provider    string
 *   cf0000004-0000-0000-0000-000000000002  pipeline_count    number
 *   cf0000004-0000-0000-0000-000000000003  soc2_certified    boolean
 *   cf0000004-0000-0000-0000-000000000004  contract_start    date
 *   cf0000004-0000-0000-0000-000000000005  deploy_model      single_select
 *   cf0000004-0000-0000-0000-000000000006  active_regions    multi_select
 *   cf0000004-0000-0000-0000-000000000007  tier_notes        string   (ARCHIVED)
 *   cf0000004-0000-0000-0000-000000000008  budget_code       string   (required)
 */

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export const CF_SEED_TENANT = 'cf000001-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Custom field definition shape
// ---------------------------------------------------------------------------

export interface SeedCustomFieldDef {
  id: string;
  tenantId: string;
  fieldKey: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'single_select' | 'multi_select';
  required: boolean;
  options: string[] | null;
  constraints: Record<string, unknown> | null;
  appliesTo: string;
  displayOrder: number;
  archivedAt: Date | null;
}

// ---------------------------------------------------------------------------
// 8 field definitions — all six data types represented
// ---------------------------------------------------------------------------

export const CF_SEED_DEFS: SeedCustomFieldDef[] = [
  // 1. string — optional, maxLength constraint
  {
    id: 'cf000004-0000-0000-0000-000000000001',
    tenantId: CF_SEED_TENANT,
    fieldKey: 'cloud_provider',
    label: 'Cloud Provider Name',
    dataType: 'string',
    required: false,
    options: null,
    constraints: { maxLength: 100 },
    appliesTo: 'organization',
    displayOrder: 1,
    archivedAt: null,
  },

  // 2. number — optional, min/max + integer flag
  {
    id: 'cf000004-0000-0000-0000-000000000002',
    tenantId: CF_SEED_TENANT,
    fieldKey: 'pipeline_count',
    label: 'Active Pipeline Count',
    dataType: 'number',
    required: false,
    options: null,
    constraints: { min: 0, max: 500, integer: true },
    appliesTo: 'organization',
    displayOrder: 2,
    archivedAt: null,
  },

  // 3. boolean — optional
  {
    id: 'cf000004-0000-0000-0000-000000000003',
    tenantId: CF_SEED_TENANT,
    fieldKey: 'soc2_certified',
    label: 'SOC 2 Type II Certified',
    dataType: 'boolean',
    required: false,
    options: null,
    constraints: null,
    appliesTo: 'organization',
    displayOrder: 3,
    archivedAt: null,
  },

  // 4. date — optional, ISO 8601 with UTC normalisation
  {
    id: 'cf000004-0000-0000-0000-000000000004',
    tenantId: CF_SEED_TENANT,
    fieldKey: 'contract_start',
    label: 'Contract Start Date',
    dataType: 'date',
    required: false,
    options: null,
    constraints: null,
    appliesTo: 'organization',
    displayOrder: 4,
    archivedAt: null,
  },

  // 5. single_select — optional, fixed allow-list
  {
    id: 'cf000004-0000-0000-0000-000000000005',
    tenantId: CF_SEED_TENANT,
    fieldKey: 'deploy_model',
    label: 'Deployment Model',
    dataType: 'single_select',
    required: false,
    options: ['cloud', 'on-prem', 'hybrid'],
    constraints: null,
    appliesTo: 'organization',
    displayOrder: 5,
    archivedAt: null,
  },

  // 6. multi_select — optional, allow-list, maxItems=3
  {
    id: 'cf000004-0000-0000-0000-000000000006',
    tenantId: CF_SEED_TENANT,
    fieldKey: 'active_regions',
    label: 'Active Deployment Regions',
    dataType: 'multi_select',
    required: false,
    options: ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1'],
    constraints: { maxItems: 3 },
    appliesTo: 'organization',
    displayOrder: 6,
    archivedAt: null,
  },

  // 7. string — ARCHIVED (legacy field; values preserved for reporting)
  {
    id: 'cf000004-0000-0000-0000-000000000007',
    tenantId: CF_SEED_TENANT,
    fieldKey: 'tier_notes',
    label: 'Tier Notes (deprecated)',
    dataType: 'string',
    required: false,
    options: null,
    constraints: { maxLength: 500 },
    appliesTo: 'organization',
    displayOrder: 7,
    archivedAt: new Date('2024-01-15T00:00:00Z'),
  },

  // 8. string — required, regex constraint (budget code format)
  {
    id: 'cf000004-0000-0000-0000-000000000008',
    tenantId: CF_SEED_TENANT,
    fieldKey: 'budget_code',
    label: 'Budget Code',
    dataType: 'string',
    required: true,
    options: null,
    constraints: { regex: '^[A-Z]{2}-\\d{4}$' },
    appliesTo: 'organization',
    displayOrder: 8,
    archivedAt: null,
  },
];

// ---------------------------------------------------------------------------
// Active definitions (exclude archived)
// ---------------------------------------------------------------------------

export const CF_SEED_ACTIVE_DEFS = CF_SEED_DEFS.filter((d) => !d.archivedAt);

// ---------------------------------------------------------------------------
// Organization seed records
// ---------------------------------------------------------------------------

export interface SeedOrgWithCustomFields {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  slaTier: string;
  region: string;
  status: 'active' | 'inactive';
  customFieldValues: Record<string, unknown>;
}

export const CF_SEED_ORGS: SeedOrgWithCustomFields[] = [
  // 1. Valid metadata — all active definitions either optional-absent or correctly typed
  {
    id: 'cf000002-0000-0000-0000-000000000001',
    tenantId: CF_SEED_TENANT,
    name: 'Alpha Cloud Co',
    slug: 'alpha-cloud-co',
    slaTier: 'premium',
    region: 'us-east-1',
    status: 'active',
    customFieldValues: {
      cloud_provider: 'AWS',
      pipeline_count: 12,
      soc2_certified: true,
      contract_start: '2024-01-01T00:00:00.000Z',
      deploy_model: 'cloud',
      active_regions: ['us-east-1', 'eu-west-1'],
      budget_code: 'AB-1234',
    },
  },

  // 2. Valid metadata — minimal (only required field)
  {
    id: 'cf000002-0000-0000-0000-000000000002',
    tenantId: CF_SEED_TENANT,
    name: 'Beta On-Prem Ltd',
    slug: 'beta-on-prem-ltd',
    slaTier: 'standard',
    region: 'eu-west-1',
    status: 'active',
    customFieldValues: {
      budget_code: 'BE-0001',
    },
  },

  // 3. Legacy metadata — contains a value for the archived 'tier_notes' field.
  //    This row was written before tier_notes was archived. The archived value
  //    must remain readable and must not block unrelated updates.
  {
    id: 'cf000002-0000-0000-0000-000000000003',
    tenantId: CF_SEED_TENANT,
    name: 'Gamma Legacy Systems',
    slug: 'gamma-legacy-systems',
    slaTier: 'enterprise',
    region: 'ap-southeast-1',
    status: 'active',
    customFieldValues: {
      budget_code: 'GA-2020',
      tier_notes: 'Enterprise tier — review Q4 2023',  // archived field value
      deploy_model: 'hybrid',
    },
  },

  // 4. Orphan metadata — contains a key that has never been defined for
  //    CF_SEED_TENANT.  This simulates a row written via a migration or
  //    imported from another system before definitions were established.
  //    The row must read successfully; it must not block unrelated updates.
  {
    id: 'cf000002-0000-0000-0000-000000000004',
    tenantId: CF_SEED_TENANT,
    name: 'Delta Imported Corp',
    slug: 'delta-imported-corp',
    slaTier: 'standard',
    region: 'us-west-2',
    status: 'active',
    customFieldValues: {
      budget_code: 'DE-9999',
      unknown_key_from_import: 'imported-value',  // orphan: no definition exists
    },
  },

  // 5. All six active data types populated — used for comprehensive read/report tests
  {
    id: 'cf000002-0000-0000-0000-000000000005',
    tenantId: CF_SEED_TENANT,
    name: 'Epsilon Full Stack Inc',
    slug: 'epsilon-full-stack-inc',
    slaTier: 'premium',
    region: 'eu-central-1',
    status: 'active',
    customFieldValues: {
      cloud_provider: 'Azure',
      pipeline_count: 42,
      soc2_certified: false,
      contract_start: '2023-06-01T00:00:00.000Z',
      deploy_model: 'on-prem',
      active_regions: ['eu-central-1', 'eu-west-1'],
      budget_code: 'EP-5678',
    },
  },
];

// ---------------------------------------------------------------------------
// Convenience lookups
// ---------------------------------------------------------------------------

/** The organization with legacy (archived-field) metadata. */
export const CF_SEED_ORG_WITH_LEGACY = CF_SEED_ORGS.find(
  (o) => o.id === 'cf000002-0000-0000-0000-000000000003',
)!;

/** The organization with orphan metadata. */
export const CF_SEED_ORG_WITH_ORPHAN = CF_SEED_ORGS.find(
  (o) => o.id === 'cf000002-0000-0000-0000-000000000004',
)!;

/** A payload that passes write validation against CF_SEED_ACTIVE_DEFS. */
export const CF_VALID_WRITE_PAYLOAD: Record<string, unknown> = {
  cloud_provider: 'GCP',
  pipeline_count: 5,
  soc2_certified: true,
  contract_start: '2025-01-01T00:00:00Z',
  deploy_model: 'cloud',
  active_regions: ['us-east-1'],
  budget_code: 'ZZ-0000',
};

/** A payload that should fail validation: unknown key + type error + missing required. */
export const CF_INVALID_WRITE_PAYLOAD: Record<string, unknown> = {
  cloud_provider: 999,                  // wrong type (should be string)
  unknown_field: 'surprise',            // unknown key
  pipeline_count: 'five',               // wrong type (should be number)
  // budget_code intentionally absent (required field)
};
