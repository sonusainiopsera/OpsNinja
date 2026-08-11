/**
 * MSW handlers for Organizations management endpoints — WO-029.
 *
 * Committed alongside component tests so the Organizations page runs
 * offline without a live backend.
 *
 * State is held in module-level mutable arrays so tests can inspect or
 * mutate it; call resetOrganizationHandlers() in afterEach to restore.
 */

import { http, HttpResponse } from 'msw';
import type {
  Organization,
  OrgContact,
  CustomFieldDef,
  CustomFieldValue,
  AgentScope,
} from '../../api/organizations/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const MOCK_ORG_ACME: Organization = {
  id: 'org-001',
  tenantId: 'ten-001',
  name: 'Acme Corp',
  tier: 'enterprise',
  region: 'us-east',
  status: 'active',
  primaryContactId: 'con-001',
  slaAttainmentPct: 94,
  openTicketCount: 12,
  domain: 'acme.example.com',
  avatarUrl: null,
  version: 1,
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-06-01T09:00:00Z',
};

export const MOCK_ORG_GLOBEX: Organization = {
  id: 'org-002',
  tenantId: 'ten-001',
  name: 'Globex Corporation',
  tier: 'growth',
  region: 'eu-west',
  status: 'active',
  primaryContactId: null,
  slaAttainmentPct: 87,
  openTicketCount: 5,
  domain: null,
  avatarUrl: null,
  version: 2,
  createdAt: '2024-02-20T08:00:00Z',
  updatedAt: '2024-07-10T14:00:00Z',
};

export const MOCK_ORG_INACTIVE: Organization = {
  id: 'org-003',
  tenantId: 'ten-001',
  name: 'Defunct Ltd',
  tier: 'starter',
  region: null,
  status: 'inactive',
  primaryContactId: null,
  slaAttainmentPct: null,
  openTicketCount: 0,
  domain: null,
  avatarUrl: null,
  version: 1,
  createdAt: '2023-11-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

export const MOCK_CONTACTS: OrgContact[] = [
  {
    id: 'con-001',
    tenantId: 'ten-001',
    organizationId: 'org-001',
    email: 'alice@acme.example.com',
    fullName: 'Alice Acme',
    jobTitle: 'CTO',
    phone: '+15550001234',
    portalAccessEnabled: true,
    status: 'active',
    version: 1,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'con-002',
    tenantId: 'ten-001',
    organizationId: 'org-001',
    email: 'bob@acme.example.com',
    fullName: 'Bob Acme',
    jobTitle: 'VP Engineering',
    phone: null,
    portalAccessEnabled: false,
    status: 'active',
    version: 1,
    createdAt: '2024-01-16T10:00:00Z',
    updatedAt: '2024-01-16T10:00:00Z',
  },
  {
    id: 'con-003',
    tenantId: 'ten-001',
    organizationId: 'org-001',
    email: 'carol@acme.example.com',
    fullName: 'Carol Suspended',
    jobTitle: null,
    phone: null,
    portalAccessEnabled: false,
    status: 'suspended',
    version: 1,
    createdAt: '2024-02-01T10:00:00Z',
    updatedAt: '2024-03-01T10:00:00Z',
  },
];

export const MOCK_CUSTOM_FIELD_DEFS: CustomFieldDef[] = [
  {
    id: 'cfd-001',
    tenantId: 'ten-001',
    key: 'crm_account_id',
    label: 'CRM Account ID',
    dataType: 'string',
    required: false,
    appliesToTier: null,
    options: null,
    archived: false,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cfd-002',
    tenantId: 'ten-001',
    key: 'contract_value',
    label: 'Contract Value ($)',
    dataType: 'number',
    required: false,
    appliesToTier: ['enterprise', 'growth'],
    options: null,
    archived: false,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cfd-003',
    tenantId: 'ten-001',
    key: 'managed_account',
    label: 'Managed Account',
    dataType: 'boolean',
    required: false,
    appliesToTier: null,
    options: null,
    archived: false,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cfd-004',
    tenantId: 'ten-001',
    key: 'renewal_date',
    label: 'Renewal Date',
    dataType: 'date',
    required: false,
    appliesToTier: null,
    options: null,
    archived: false,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cfd-005',
    tenantId: 'ten-001',
    key: 'support_tier',
    label: 'Support Tier',
    dataType: 'select',
    required: true,
    appliesToTier: null,
    options: [
      { value: 'basic', label: 'Basic' },
      { value: 'standard', label: 'Standard' },
      { value: 'premium', label: 'Premium' },
    ],
    archived: false,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cfd-006',
    tenantId: 'ten-001',
    key: 'product_lines',
    label: 'Product Lines',
    dataType: 'multi_select',
    required: false,
    appliesToTier: null,
    options: [
      { value: 'platform', label: 'Platform' },
      { value: 'analytics', label: 'Analytics' },
      { value: 'integrations', label: 'Integrations' },
    ],
    archived: false,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cfd-007',
    tenantId: 'ten-001',
    key: 'legacy_id',
    label: 'Legacy System ID (archived)',
    dataType: 'string',
    required: false,
    appliesToTier: null,
    options: null,
    archived: true,
    version: 1,
    createdAt: '2023-06-01T00:00:00Z',
  },
];

export const MOCK_METADATA: CustomFieldValue[] = [
  { fieldKey: 'crm_account_id', value: 'CRM-12345' },
  { fieldKey: 'contract_value', value: 450000 },
  { fieldKey: 'managed_account', value: true },
  { fieldKey: 'renewal_date', value: '2025-01-15' },
  { fieldKey: 'support_tier', value: 'premium' },
  { fieldKey: 'product_lines', value: ['platform', 'analytics'] },
];

export const MOCK_AGENT_SCOPES: AgentScope[] = [
  {
    agentId: 'usr-agent-001',
    agentName: 'Alice Agent',
    agentEmail: 'alice.agent@opsninja.io',
    assignedAt: '2024-03-01T10:00:00Z',
  },
  {
    agentId: 'usr-agent-002',
    agentName: 'Bob Agent',
    agentEmail: 'bob.agent@opsninja.io',
    assignedAt: '2024-04-15T10:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Mutable state (reset in afterEach)
// ---------------------------------------------------------------------------

let mockOrgs = [...[MOCK_ORG_ACME, MOCK_ORG_GLOBEX, MOCK_ORG_INACTIVE]];
let mockContacts = [...MOCK_CONTACTS];
let mockFieldDefs = [...MOCK_CUSTOM_FIELD_DEFS];
let nextOrgId = 100;
let nextContactId = 100;
let nextFieldId = 100;

export function resetOrganizationHandlers() {
  mockOrgs = [...[MOCK_ORG_ACME, MOCK_ORG_GLOBEX, MOCK_ORG_INACTIVE]];
  mockContacts = [...MOCK_CONTACTS];
  mockFieldDefs = [...MOCK_CUSTOM_FIELD_DEFS];
  nextOrgId = 100;
  nextContactId = 100;
  nextFieldId = 100;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const organizationHandlers = [
  // GET /api/v1/organizations
  http.get('/api/v1/organizations', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const tier = url.searchParams.get('tier');
    const q = url.searchParams.get('q');
    const cursor = url.searchParams.get('cursor');

    let results = mockOrgs;
    if (status) results = results.filter((o) => o.status === status);
    if (tier) results = results.filter((o) => o.tier === tier);
    if (q) results = results.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));

    // Minimal cursor simulation: cursor is an index
    const startIdx = cursor ? parseInt(cursor, 10) : 0;
    const limit = parseInt(url.searchParams.get('limit') ?? '25', 10);
    const page = results.slice(startIdx, startIdx + limit);
    const nextCursor = startIdx + limit < results.length ? String(startIdx + limit) : null;

    return HttpResponse.json({ data: page, nextCursor });
  }),

  // GET /api/v1/organizations/:id
  http.get('/api/v1/organizations/:id', ({ params }) => {
    const org = mockOrgs.find((o) => o.id === params['id']);
    if (!org) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } }, { status: 404 });
    return HttpResponse.json({ data: org });
  }),

  // POST /api/v1/organizations
  http.post('/api/v1/organizations', async ({ request }) => {
    const body = await request.json() as Partial<Organization>;
    const newOrg: Organization = {
      id: `org-${++nextOrgId}`,
      tenantId: 'ten-001',
      name: body.name ?? 'New Organization',
      tier: body.tier ?? 'starter',
      region: body.region ?? null,
      status: 'active',
      primaryContactId: null,
      slaAttainmentPct: null,
      openTicketCount: 0,
      domain: body.domain ?? null,
      avatarUrl: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockOrgs.push(newOrg);
    return HttpResponse.json({ data: newOrg }, { status: 201 });
  }),

  // PUT /api/v1/organizations/:id
  http.put('/api/v1/organizations/:id', async ({ params, request }) => {
    const idx = mockOrgs.findIndex((o) => o.id === params['id']);
    if (idx === -1) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    const body = await request.json() as Partial<Organization> & { version?: number };
    if (body.version !== undefined && body.version !== mockOrgs[idx]!.version) {
      return HttpResponse.json({ error: { code: 'VERSION_CONFLICT', message: 'Version conflict' } }, { status: 409 });
    }
    mockOrgs[idx] = { ...mockOrgs[idx]!, ...body, version: (mockOrgs[idx]!.version) + 1, updatedAt: new Date().toISOString() };
    return HttpResponse.json({ data: mockOrgs[idx] });
  }),

  // POST /api/v1/organizations/:id/deactivate
  http.post('/api/v1/organizations/:id/deactivate', ({ params }) => {
    const idx = mockOrgs.findIndex((o) => o.id === params['id']);
    if (idx === -1) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    mockOrgs[idx] = { ...mockOrgs[idx]!, status: 'inactive', updatedAt: new Date().toISOString() };
    return HttpResponse.json({ data: mockOrgs[idx] });
  }),

  // POST /api/v1/organizations/:id/reactivate
  http.post('/api/v1/organizations/:id/reactivate', ({ params }) => {
    const idx = mockOrgs.findIndex((o) => o.id === params['id']);
    if (idx === -1) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    mockOrgs[idx] = { ...mockOrgs[idx]!, status: 'active', updatedAt: new Date().toISOString() };
    return HttpResponse.json({ data: mockOrgs[idx] });
  }),

  // GET /api/v1/organizations/:orgId/contacts
  http.get('/api/v1/organizations/:orgId/contacts', ({ params, request }) => {
    const url = new URL(request.url);
    const orgId = params['orgId'] as string;
    const status = url.searchParams.get('status');
    let results = mockContacts.filter((c) => c.organizationId === orgId);
    if (status) results = results.filter((c) => c.status === status);
    return HttpResponse.json({ data: results, nextCursor: null });
  }),

  // POST /api/v1/organizations/:orgId/contacts
  http.post('/api/v1/organizations/:orgId/contacts', async ({ params, request }) => {
    const orgId = params['orgId'] as string;
    const body = await request.json() as Partial<OrgContact>;
    const emailLower = (body.email ?? '').toLowerCase().trim();
    if (mockContacts.some((c) => c.email === emailLower)) {
      return HttpResponse.json({
        error: { code: 'CONTACT_EMAIL_CONFLICT', message: 'Email already exists in this tenant.' },
      }, { status: 409 });
    }
    const newContact: OrgContact = {
      id: `con-${++nextContactId}`,
      tenantId: 'ten-001',
      organizationId: orgId,
      email: emailLower,
      fullName: body.fullName ?? '',
      jobTitle: body.jobTitle ?? null,
      phone: body.phone ?? null,
      portalAccessEnabled: body.portalAccessEnabled ?? false,
      status: 'active',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockContacts.push(newContact);
    return HttpResponse.json({ data: newContact }, { status: 201 });
  }),

  // PATCH /api/v1/organizations/:orgId/contacts/:id
  http.patch('/api/v1/organizations/:orgId/contacts/:id', async ({ params, request }) => {
    const idx = mockContacts.findIndex(
      (c) => c.organizationId === params['orgId'] && c.id === params['id'],
    );
    if (idx === -1) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    const body = await request.json() as Partial<OrgContact> & { version?: number };
    if (body.version !== undefined && body.version !== mockContacts[idx]!.version) {
      return HttpResponse.json({ error: { code: 'CONTACT_VERSION_CONFLICT', message: 'Version conflict' } }, { status: 409 });
    }
    mockContacts[idx] = { ...mockContacts[idx]!, ...body, version: mockContacts[idx]!.version + 1, updatedAt: new Date().toISOString() };
    return HttpResponse.json({ data: mockContacts[idx] });
  }),

  // GET /api/v1/custom-field-definitions
  http.get('/api/v1/custom-field-definitions', () => {
    return HttpResponse.json({ data: mockFieldDefs });
  }),

  // POST /api/v1/custom-field-definitions
  http.post('/api/v1/custom-field-definitions', async ({ request }) => {
    const body = await request.json() as Partial<CustomFieldDef>;
    if (mockFieldDefs.some((f) => f.key === body.key)) {
      return HttpResponse.json({ error: { code: 'KEY_CONFLICT', message: 'Field key already exists.' } }, { status: 409 });
    }
    const newDef: CustomFieldDef = {
      id: `cfd-${++nextFieldId}`,
      tenantId: 'ten-001',
      key: body.key ?? '',
      label: body.label ?? '',
      dataType: body.dataType ?? 'string',
      required: body.required ?? false,
      appliesToTier: body.appliesToTier ?? null,
      options: body.options ?? null,
      archived: false,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    mockFieldDefs.push(newDef);
    return HttpResponse.json({ data: newDef }, { status: 201 });
  }),

  // GET /api/v1/organizations/:orgId/metadata
  http.get('/api/v1/organizations/:orgId/metadata', () => {
    return HttpResponse.json({ data: MOCK_METADATA });
  }),

  // PUT /api/v1/organizations/:orgId/metadata
  http.put('/api/v1/organizations/:orgId/metadata', async ({ request }) => {
    const body = await request.json() as { values: typeof MOCK_METADATA };
    return HttpResponse.json({ data: body.values });
  }),

  // GET /api/v1/organizations/:orgId/agent-scopes
  http.get('/api/v1/organizations/:orgId/agent-scopes', () => {
    return HttpResponse.json({ data: MOCK_AGENT_SCOPES });
  }),
];
